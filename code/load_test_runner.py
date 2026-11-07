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
    create_series, update_series, get_series,
)
from sqs_client import send_job_message
from stats_aggregator import merge_stats_csvs, merge_failures_csvs, merge_history_csvs
from analysis.request_headers import header_names, redact

RESULTS_DIR = "load_test_results"
os.makedirs(RESULTS_DIR, exist_ok=True)

USE_SQS = os.environ.get("USE_SQS", "false").lower() == "true"

# A single worker has been validated comfortably up to this many concurrent
# users. Requests above this get split into multiple child jobs so several
# worker pods can process them in parallel.
SPLIT_THRESHOLD = 50
MAX_CHILD_JOBS = 10

# Statuses after which a job never changes again.
TERMINAL_STATUSES = ("completed", "failed", "timeout", "cancelled")

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
        update_job(job_id, status="cancelled")


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


def _run_api_job(job_id, target_url, target_path, cases, users, spawn_rate, duration_seconds, headers=None):
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

    locustfile_path = os.path.join(os.path.dirname(__file__), "locust_tests", "dynamic_locustfile.py")
    _run_locust(job_id, locustfile_path, env, target_url, users, spawn_rate, duration_seconds, csv_prefix)


def _run_website_job(job_id, target_url, paths, users, spawn_rate, duration_seconds, headers=None):
    job_dir = os.path.join(RESULTS_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)

    paths_file = os.path.join(job_dir, "paths.json")
    with open(paths_file, "w") as f:
        json.dump(paths, f)

    csv_prefix = os.path.join(job_dir, "result")

    env = os.environ.copy()
    env["LOCUST_PATHS_FILE"] = paths_file
    _with_headers(env, headers)

    locustfile_path = os.path.join(os.path.dirname(__file__), "locust_tests", "website_locustfile.py")
    _run_locust(job_id, locustfile_path, env, target_url, users, spawn_rate, duration_seconds, csv_prefix)


def _run_locust(job_id, locustfile_path, env, target_url, users, spawn_rate, duration_seconds, csv_prefix):
    if not os.path.exists(locustfile_path):
        update_job(job_id, status="failed", error=f"locustfile not found at {locustfile_path}")
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
    ]

    # Cancelled while still queued: never start Locust.
    if _is_cancel_requested(job_id):
        update_job(job_id, status="cancelled")
        return

    update_job(job_id, status="running")

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
        # A cancelled run keeps whatever CSVs Locust had written so far
        # (it rewrites them every few seconds) as partial results.
        update_job(
            job_id,
            status="cancelled" if _is_cancel_requested(job_id) else "completed",
            stdout=redact((stdout or "")[-3000:], headers),
            stderr=redact((stderr or "")[-3000:], headers),
            stats_csv=stats_csv,
            failures_csv=redact(failures_csv, headers),
            history_csv=history_csv,
        )
    except subprocess.TimeoutExpired:
        update_job(job_id, status="timeout")
    except Exception as e:
        update_job(job_id, status="failed", error=str(e))


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


def start_load_test(target_url, target_path, cases, users=5, spawn_rate=1, duration_seconds=30, headers=None):
    """Starts a single API load test job. For large user counts, transparently
    splits into multiple child jobs distributed across workers — see
    start_split_load_test. Returns (id, is_group)."""
    if users > SPLIT_THRESHOLD:
        group_id = start_split_load_test(target_url, target_path, cases, users, spawn_rate, duration_seconds,
                                         headers=headers)
        return group_id, True

    job_id = str(uuid.uuid4())
    create_job(job_id, target_url, users, spawn_rate, duration_seconds, header_names=header_names(headers))
    _dispatch_single("api", job_id, target_url, users, spawn_rate, duration_seconds,
                      target_path=target_path, cases=cases, headers=headers)
    return job_id, False


def start_website_load_test(target_url, paths, users=5, spawn_rate=1, duration_seconds=30, headers=None):
    if users > SPLIT_THRESHOLD:
        group_id = start_split_website_load_test(target_url, paths, users, spawn_rate, duration_seconds,
                                                 headers=headers)
        return group_id, True

    job_id = str(uuid.uuid4())
    create_job(job_id, target_url, users, spawn_rate, duration_seconds, header_names=header_names(headers))
    _dispatch_single("website", job_id, target_url, users, spawn_rate, duration_seconds, paths=paths,
                     headers=headers)
    return job_id, False


def start_split_load_test(target_url, target_path, cases, users, spawn_rate, duration_seconds, headers=None):
    per_child_users = _split_users(users)
    group_id = str(uuid.uuid4())
    names = header_names(headers)
    create_job_group(group_id, target_url, "api", users, spawn_rate, duration_seconds, len(per_child_users),
                     header_names=names)

    for child_users in per_child_users:
        job_id = str(uuid.uuid4())
        create_job(job_id, target_url, child_users, spawn_rate, duration_seconds, group_id=group_id,
                   header_names=names)
        _dispatch_single("api", job_id, target_url, child_users, spawn_rate, duration_seconds,
                          target_path=target_path, cases=cases, headers=headers)

    return group_id


def start_split_website_load_test(target_url, paths, users, spawn_rate, duration_seconds, headers=None):
    per_child_users = _split_users(users)
    group_id = str(uuid.uuid4())
    names = header_names(headers)
    create_job_group(group_id, target_url, "website", users, spawn_rate, duration_seconds, len(per_child_users),
                     header_names=names)

    for child_users in per_child_users:
        job_id = str(uuid.uuid4())
        create_job(job_id, target_url, child_users, spawn_rate, duration_seconds, group_id=group_id,
                   header_names=names)
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

    return result

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
