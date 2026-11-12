import json
import math
import os
import subprocess
import sys
import threading
import time
import uuid

from job_store import (
    create_job, update_job, get_job,
    create_job_group, update_job_group, get_job_group, list_child_jobs,
    create_series, update_series, get_series, list_active_runs,
)
from sqs_client import send_job_message
from stats_aggregator import merge_stats_csvs, merge_failures_csvs, merge_history_csvs
from analysis.request_headers import header_names, redact

RESULTS_DIR = "load_test_results"
os.makedirs(RESULTS_DIR, exist_ok=True)

USE_SQS = os.environ.get("USE_SQS", "false").lower() == "true"

# One Locust process has been validated comfortably up to this many concurrent
# users. Larger runs are split into child jobs, each its own Locust process,
# running in parallel on THIS host (one per 50 users, at most 10); their
# results are merged and the merged p95 is an approximation. Spreading them
# over several machines would need queue mode, which is not deployed (future
# work).
SPLIT_THRESHOLD = 50
MAX_CHILD_JOBS = 10

# Statuses after which a job never changes again. "interrupted": the backend
# process that ran it stopped (see job_store.mark_interrupted_runs).
TERMINAL_STATUSES = ("completed", "failed", "timeout", "cancelled", "interrupted")
ACTIVE_STATUSES = ("queued", "running")

# Running Locust processes by job id, so a run can be stopped, and the ids
# whose cancellation was requested. Both live in this process only.
_processes = {}
_cancel_requested = set()
_proc_lock = threading.Lock()


def _is_cancel_requested(job_id):
    with _proc_lock:
        return job_id in _cancel_requested


def _cancel_job(job_id):
    """Stops one job. A queued job is marked cancelled straight away; a
    running one has its Locust process terminated, and _run_locust() then
    records it as cancelled with any partial CSVs."""
    job = get_job(job_id)
    if job is None or job["status"] in TERMINAL_STATUSES:
        return
    with _proc_lock:
        _cancel_requested.add(job_id)
        proc = _processes.get(job_id)
    if proc is not None:
        proc.terminate()
    elif job["status"] == "queued":
        _set_job(job_id, status="cancelled")


def cancel_run(run_id):
    """Cancels a single job, every child of a split group, or a whole repeat
    series (no further repeats start, and the current one is stopped).
    Returns False if no such run exists."""
    series = get_series(run_id)
    if series is not None:
        if series["status"] not in TERMINAL_STATUSES:
            with _proc_lock:
                _cancel_requested.add(run_id)
            if series["run_ids"]:
                cancel_run(series["run_ids"][-1])
        return True
    if get_job_group(run_id) is not None:
        for child in list_child_jobs(run_id):
            _cancel_job(child["job_id"])
        return True
    if get_job(run_id) is not None:
        _cancel_job(run_id)
        return True
    return False


def _with_headers(env, headers):
    """Request headers reach Locust only through its environment, so their
    values never touch the disk or the database."""
    if headers:
        env["LOCUST_HEADERS"] = json.dumps(headers)
    return env


LOCUST_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "locust_tests")


def _locustfiles(user_file, env, job_dir, step_plan):
    """The -f argument. A capacity run adds the step-load shape, combined with
    the user file as "a.py,b.py", so normal runs never load it."""
    path = os.path.join(LOCUST_DIR, user_file)
    if step_plan:
        plan = dict(step_plan, steps_file=os.path.join(job_dir, "steps.json"))
        env["LOCUST_STEP_PLAN"] = json.dumps(plan)
        path += "," + os.path.join(LOCUST_DIR, "step_shape.py")
    return path


def _steps_reader(job_dir):
    """Reads the step records a capacity run wrote (see step_shape.py)."""
    def read():
        steps_file = os.path.join(job_dir, "steps.json")
        if not os.path.exists(steps_file):
            return {}
        with open(steps_file) as f:
            return {"capacity_steps": f.read()}
    return read


def _run_api_job(job_id, target_url, target_path, cases, users, spawn_rate, duration_seconds, headers=None,
                 step_plan=None):
    job_dir = os.path.join(RESULTS_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)

    cases_file = os.path.join(job_dir, "cases.json")
    with open(cases_file, "w") as f:
        json.dump(cases, f)

    csv_prefix = os.path.join(job_dir, "result")

    env = os.environ.copy()
    env["LOCUST_CASES_FILE"] = cases_file
    env["LOCUST_TARGET_PATH"] = target_path
    _with_headers(env, headers)

    locustfile_path = _locustfiles("dynamic_locustfile.py", env, job_dir, step_plan)
    _run_locust(job_id, locustfile_path, env, target_url, users, spawn_rate, duration_seconds, csv_prefix,
                extra_results=_steps_reader(job_dir) if step_plan else None)


def _run_website_job(job_id, target_url, paths, users, spawn_rate, duration_seconds, headers=None,
                     step_plan=None):
    job_dir = os.path.join(RESULTS_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)

    paths_file = os.path.join(job_dir, "paths.json")
    with open(paths_file, "w") as f:
        json.dump(paths, f)

    csv_prefix = os.path.join(job_dir, "result")

    env = os.environ.copy()
    env["LOCUST_PATHS_FILE"] = paths_file
    _with_headers(env, headers)

    locustfile_path = _locustfiles("website_locustfile.py", env, job_dir, step_plan)
    _run_locust(job_id, locustfile_path, env, target_url, users, spawn_rate, duration_seconds, csv_prefix,
                extra_results=_steps_reader(job_dir) if step_plan else None)


def _run_locust(job_id, locustfile_path, env, target_url, users, spawn_rate, duration_seconds, csv_prefix,
                extra_results=None):
    """extra_results: optional function returning more fields to store with
    the results (read before the job is marked finished, so a poll never sees
    "completed" without them)."""
    if not all(os.path.exists(p) for p in locustfile_path.split(",")):
        _set_job(job_id, status="failed", error=f"locustfile not found at {locustfile_path}")
        return

    cmd = [
        sys.executable, "-m", "locust",
        "-f", locustfile_path,
        "--headless",
        "-u", str(users),
        "-r", str(spawn_rate),
        "-t", f"{duration_seconds}s",
        "--host", target_url,
        "--csv", csv_prefix,
        # By default Locust exits with 1 whenever any request failed, which
        # is normal for a load test. With 0 here, a non-zero exit code means
        # Locust itself went wrong (bad locustfile, crash, killed).
        "--exit-code-on-error", "0",
    ]

    # Cancelled while still queued: never start Locust.
    if _is_cancel_requested(job_id):
        _set_job(job_id, status="cancelled")
        return

    _set_job(job_id, status="running")

    try:
        # Popen instead of subprocess.run so cancel_run() can reach the
        # process. Same arguments, same output capture, same timeout.
        proc = subprocess.Popen(
            cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        with _proc_lock:
            _processes[job_id] = proc
            cancelled_meanwhile = job_id in _cancel_requested
        if cancelled_meanwhile:
            proc.terminate()
        try:
            stdout, stderr = proc.communicate(timeout=duration_seconds + 60)
        except subprocess.TimeoutExpired:
            # What subprocess.run does on timeout: kill, then collect output.
            proc.kill()
            proc.communicate()
            raise
        finally:
            with _proc_lock:
                _processes.pop(job_id, None)

        stats_csv = None
        stats_file = f"{csv_prefix}_stats.csv"
        if os.path.exists(stats_file):
            with open(stats_file) as f:
                stats_csv = f.read()

        # A run with zero failures produces no failures file.
        failures_csv = None
        failures_file = f"{csv_prefix}_failures.csv"
        if os.path.exists(failures_file):
            with open(failures_file) as f:
                failures_csv = f.read()

        # One "Aggregated" row per second of the run, used for the timeline.
        history_csv = None
        history_file = f"{csv_prefix}_stats_history.csv"
        if os.path.exists(history_file):
            with open(history_file) as f:
                history_csv = f.read()

        # Belt and braces: if Locust ever echoed a header value, hide it
        # before anything is stored.
        headers = json.loads(env.get("LOCUST_HEADERS") or "{}")
        extra = extra_results() if extra_results else {}
        # A cancelled run keeps whatever CSVs Locust had written so far
        # (it rewrites them every few seconds) as partial results. Otherwise a
        # run only counts as completed when Locust exited cleanly AND wrote
        # its statistics; anything else is a failed run, with the end of
        # Locust's error output as the reason.
        error = None
        if _is_cancel_requested(job_id):
            status = "cancelled"
        elif proc.returncode != 0:
            status = "failed"
            error = f"Locust exited with code {proc.returncode}. " + _error_tail(stderr, stdout)
        elif stats_csv is None:
            status = "failed"
            error = "Locust finished without writing statistics. " + _error_tail(stderr, stdout)
        else:
            status = "completed"
        _set_job(
            job_id,
            status=status,
            error=redact(error, headers),
            stdout=redact((stdout or "")[-3000:], headers),
            stderr=redact((stderr or "")[-3000:], headers),
            stats_csv=stats_csv,
            failures_csv=redact(failures_csv, headers),
            history_csv=history_csv,
            **extra,
        )
    except subprocess.TimeoutExpired:
        _set_job(job_id, status="timeout")
    except Exception as e:
        _set_job(job_id, status="failed", error=str(e))


def _error_tail(stderr, stdout, limit=1200):
    """The useful end of Locust's output for an error message: the last
    traceback if there is one (Locust prints its final stats table after it),
    otherwise the last lines."""
    text = (stderr or "").strip() or (stdout or "").strip()
    if not text:
        return "It printed nothing."
    start = text.rfind("Traceback (most recent call last)")
    if start != -1:
        text = text[start:]
        for marker in ("\nType     Name", "\nResponse time percentiles"):
            cut = text.find(marker)
            if cut != -1:
                text = text[:cut]
    else:
        text = "\n".join(text.splitlines()[-15:])
    text = text.strip()
    return text if len(text) <= limit else "..." + text[-limit:]


def _set_job(job_id, **fields):
    """update_job, then refresh the job's split group (if any), so the
    group's stored status follows its children."""
    update_job(job_id, **fields)
    if "status" in fields:
        job = get_job(job_id)
        if job and job.get("group_id"):
            get_group_status(job["group_id"])


def _dispatch_single(job_type, job_id, target_url, users, spawn_rate, duration_seconds,
                      target_path=None, cases=None, paths=None, headers=None):
    """Runs one job locally (thread) or sends it to SQS, depending on USE_SQS."""
    if USE_SQS:
        payload = {
            "job_id": job_id, "job_type": job_type, "target_url": target_url,
            "users": users, "spawn_rate": spawn_rate, "duration_seconds": duration_seconds,
        }
        if job_type == "api":
            payload["target_path"] = target_path
            payload["cases"] = cases
        else:
            payload["paths"] = paths
        send_job_message(payload)
    else:
        target = _run_api_job if job_type == "api" else _run_website_job
        args = (
            (job_id, target_url, target_path, cases, users, spawn_rate, duration_seconds, headers)
            if job_type == "api"
            else (job_id, target_url, paths, users, spawn_rate, duration_seconds, headers)
        )
        threading.Thread(target=target, args=args, daemon=True).start()


def _split_users(total_users):
    """Splits a large user count into a list of per-child user counts,
    each no larger than SPLIT_THRESHOLD, capped at MAX_CHILD_JOBS children."""
    child_count = min(MAX_CHILD_JOBS, math.ceil(total_users / SPLIT_THRESHOLD))
    base = total_users // child_count
    remainder = total_users % child_count
    return [base + (1 if i < remainder else 0) for i in range(child_count) if base + (1 if i < remainder else 0) > 0]


def _store_meta(update, run_id, meta):
    """Saves extra run settings (see job_store.RUN_META_COLUMNS) as JSON text."""
    fields = {k: json.dumps(v) for k, v in (meta or {}).items() if v is not None}
    if fields:
        update(run_id, **fields)


def case_expectations(cases):
    """{label: "accept" | "reject"} for the cases that carry an expectation,
    or None when none do (older clients, website runs)."""
    found = {c["label"]: c["expect"] for c in cases or []
             if isinstance(c, dict) and c.get("expect") in ("accept", "reject")}
    return found or None


def start_load_test(target_url, target_path, cases, users=5, spawn_rate=1, duration_seconds=30, headers=None,
                    meta=None):
    """Starts a single API load test job. For large user counts, transparently
    splits into child jobs: parallel Locust processes on this host — see
    start_split_load_test. meta: extra run settings stored with the run
    (e.g. {"case_expectations": {...}}). Returns (id, is_group)."""
    if users > SPLIT_THRESHOLD:
        group_id = start_split_load_test(target_url, target_path, cases, users, spawn_rate, duration_seconds,
                                         headers=headers, meta=meta)
        return group_id, True

    job_id = str(uuid.uuid4())
    create_job(job_id, target_url, users, spawn_rate, duration_seconds, header_names=header_names(headers))
    _store_meta(update_job, job_id, meta)
    _dispatch_single("api", job_id, target_url, users, spawn_rate, duration_seconds,
                      target_path=target_path, cases=cases, headers=headers)
    return job_id, False


def start_website_load_test(target_url, paths, users=5, spawn_rate=1, duration_seconds=30, headers=None,
                            meta=None):
    if users > SPLIT_THRESHOLD:
        group_id = start_split_website_load_test(target_url, paths, users, spawn_rate, duration_seconds,
                                                 headers=headers, meta=meta)
        return group_id, True

    job_id = str(uuid.uuid4())
    create_job(job_id, target_url, users, spawn_rate, duration_seconds, header_names=header_names(headers))
    _store_meta(update_job, job_id, meta)
    _dispatch_single("website", job_id, target_url, users, spawn_rate, duration_seconds, paths=paths,
                     headers=headers)
    return job_id, False


def start_split_load_test(target_url, target_path, cases, users, spawn_rate, duration_seconds, headers=None,
                          meta=None):
    per_child_users = _split_users(users)
    group_id = str(uuid.uuid4())
    names = header_names(headers)
    create_job_group(group_id, target_url, "api", users, spawn_rate, duration_seconds, len(per_child_users),
                     header_names=names)
    _store_meta(update_job_group, group_id, meta)

    for child_users in per_child_users:
        job_id = str(uuid.uuid4())
        create_job(job_id, target_url, child_users, spawn_rate, duration_seconds, group_id=group_id,
                   header_names=names)
        _store_meta(update_job, job_id, meta)
        _dispatch_single("api", job_id, target_url, child_users, spawn_rate, duration_seconds,
                          target_path=target_path, cases=cases, headers=headers)

    return group_id


def start_split_website_load_test(target_url, paths, users, spawn_rate, duration_seconds, headers=None,
                                  meta=None):
    per_child_users = _split_users(users)
    group_id = str(uuid.uuid4())
    names = header_names(headers)
    create_job_group(group_id, target_url, "website", users, spawn_rate, duration_seconds, len(per_child_users),
                     header_names=names)
    _store_meta(update_job_group, group_id, meta)

    for child_users in per_child_users:
        job_id = str(uuid.uuid4())
        create_job(job_id, target_url, child_users, spawn_rate, duration_seconds, group_id=group_id,
                   header_names=names)
        _store_meta(update_job, job_id, meta)
        _dispatch_single("website", job_id, target_url, child_users, spawn_rate, duration_seconds, paths=paths,
                         headers=headers)

    return group_id


def get_job_status(job_id):
    return get_job(job_id)


def get_group_status(group_id):
    """Returns the combined status of a split job group. Aggregates results
    once every child job has finished; otherwise reports the group's overall
    progress state."""
    group = get_job_group(group_id)
    if group is None:
        return None

    children = list_child_jobs(group_id)
    statuses = [c["status"] for c in children]

    if any(s == "failed" for s in statuses):
        overall = "failed"
    elif any(s == "timeout" for s in statuses):
        overall = "timeout"
    elif any(s == "interrupted" for s in statuses):
        overall = "interrupted"
    elif all(s == "completed" for s in statuses):
        overall = "completed"
    elif all(s in ("completed", "cancelled") for s in statuses):
        # Every child has stopped and at least one was cancelled.
        overall = "cancelled"
    elif any(s == "running" for s in statuses):
        overall = "running"
    else:
        overall = "queued"

    result = dict(group)
    result["child_jobs"] = children
    result["status"] = overall

    # A cancelled group merges whatever partial results its children kept.
    if overall in ("completed", "cancelled") and not group.get("aggregated_stats_csv"):
        stats_list = [c["stats_csv"] for c in children if c.get("stats_csv")]
        merged = merge_stats_csvs(stats_list) if stats_list else None
        failures_list = [c["failures_csv"] for c in children if c.get("failures_csv")]
        merged_failures = merge_failures_csvs(failures_list) if failures_list else None
        history_list = [c["history_csv"] for c in children if c.get("history_csv")]
        merged_history = merge_history_csvs(history_list) if history_list else None
        update_job_group(group_id, status=overall, aggregated_stats_csv=merged,
                         aggregated_failures_csv=merged_failures,
                         aggregated_history_csv=merged_history)
        result["aggregated_stats_csv"] = merged
        result["aggregated_failures_csv"] = merged_failures
        result["aggregated_history_csv"] = merged_history
    elif overall in ("completed", "cancelled"):
        result["aggregated_stats_csv"] = group.get("aggregated_stats_csv")
        result["aggregated_failures_csv"] = group.get("aggregated_failures_csv")
        result["aggregated_history_csv"] = group.get("aggregated_history_csv")
    elif overall != group.get("status"):
        # Keep the stored status in step with the children, so lists that
        # read the stored row (the run history) never show a stale state.
        update_job_group(group_id, status=overall)

    return result


def active_run_count():
    """How many load tests are queued or running, counted the way a user
    sees them: a split group is one run, a capacity run is one run, and a
    repeat series is one run (its current repeat is not counted again)."""
    active = list_active_runs()
    in_series = {run_id for _, run_ids in active["series"] for run_id in run_ids}
    # Group rows are refreshed from their children first: a stored "running"
    # may already be finished.
    groups = [g for g in active["groups"] if g not in in_series and run_status(g) in ACTIVE_STATUSES]
    jobs = [j for j in active["jobs"] if j not in in_series]
    return len(active["series"]) + len(groups) + len(jobs)

# ---- Repeat series ----------------------------------------------------------

SERIES_POLL_SECONDS = 1


def run_status(run_id):
    """Status of an ordinary run (single job or split group), or None."""
    run = get_group_status(run_id) or get_job_status(run_id)
    return run["status"] if run else None


def start_series(job_type, target_url, users, spawn_rate, duration_seconds, repeat, start_one,
                 header_names=None):
    """Runs the same configuration `repeat` times, one after another.
    start_one() starts one ordinary run (single or split, exactly as without
    a series) and returns (run id, is_group). Returns the series id."""
    series_id = str(uuid.uuid4())
    create_series(series_id, target_url, job_type, users, spawn_rate, duration_seconds, repeat,
                  header_names=header_names)
    threading.Thread(target=_run_series, args=(series_id, repeat, start_one), daemon=True).start()
    return series_id


def _wait_for_run(run_id, sleep=time.sleep):
    while True:
        status = run_status(run_id)
        if status is None or status in TERMINAL_STATUSES:
            return status
        sleep(SERIES_POLL_SECONDS)


def _run_series(series_id, repeat, start_one, sleep=time.sleep):
    run_ids = []
    statuses = []
    update_series(series_id, status="running")
    try:
        for _ in range(repeat):
            if _is_cancel_requested(series_id):
                break
            run_id, _ = start_one()
            run_ids.append(run_id)
            update_series(series_id, run_ids=json.dumps(run_ids))
            # Cancelled between the check above and this start: stop it too.
            if _is_cancel_requested(series_id):
                cancel_run(run_id)
            status = _wait_for_run(run_id, sleep)
            statuses.append(status)
            if status != "completed":
                break  # a failed, timed-out or cancelled repeat ends the series
    except Exception as e:
        update_series(series_id, status="failed", error=str(e))
        return

    if _is_cancel_requested(series_id):
        update_series(series_id, status="cancelled")
    elif len(statuses) == repeat and all(s == "completed" for s in statuses):
        update_series(series_id, status="completed")
    else:
        update_series(series_id, status="failed",
                      error=f"repeat {len(statuses)} of {repeat} ended with status '{statuses[-1]}'")


# ---- Capacity runs ("Find capacity") ------------------------------------------

def start_capacity_test(job_type, target_url, plan, spawn_rate, slo, headers=None, target_path=None, cases=None,
                        paths=None, meta=None):
    """Starts a step-load capacity run (see analysis/capacity.py). Always ONE
    job, never split: the steps and their per-step judgement need a single
    Locust process. Runs locally only (refused in queue mode by the API)."""
    job_id = str(uuid.uuid4())
    create_job(job_id, target_url, plan["max_users"], spawn_rate, plan["total_seconds"],
               header_names=header_names(headers))
    _store_meta(update_job, job_id, meta)
    step_plan = {
        "steps": plan["steps"],
        "step_duration_seconds": plan["step_duration_seconds"],
        "spawn_rate": spawn_rate,
        "slo": slo or {},
        "early_stop": plan["early_stop"],
    }
    # A few seconds beyond the plan, so the shape (not --run-time) ends the
    # test and records the last step.
    duration = plan["total_seconds"] + 5
    if job_type == "api":
        args = (job_id, target_url, target_path, cases, plan["max_users"], spawn_rate, duration, headers)
        target = _run_api_job
    else:
        args = (job_id, target_url, paths, plan["max_users"], spawn_rate, duration, headers)
        target = _run_website_job
    threading.Thread(target=target, args=args, kwargs={"step_plan": step_plan}, daemon=True).start()
    return job_id
