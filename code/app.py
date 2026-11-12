import functools
import json
import os
import threading
from urllib.parse import urlparse
from flask import Flask, request, jsonify
from flask_cors import CORS
from analysis.sanity_check import sanity_check
from analysis.type_detector import detect_type, try_find_sitemap, extract_paths_from_sitemap
from analysis.edge_cases import generate_edge_cases
from analysis.failure_summary import summarize_failures
from analysis.case_comparison import compare_cases
from analysis.custom_cases import classify_custom_case
from analysis.regressions import detect_regressions
from analysis.problem_rate import problem_rate
from analysis.request_headers import clean_headers, header_names
from analysis.series_stats import summarize_series
from analysis.target_guard import check_target
from analysis.edge_cases import EXPECTATIONS, EXPECT_REJECT
from analysis.outcome_summary import outcome_summary
from analysis.slo import clean_slo, evaluate_slo, run_metrics
from analysis.capacity import capacity_result, clean_capacity, ramp_problem, step_slo
from job_store import get_series
from load_test_runner import start_load_test, start_website_load_test, get_job_status, get_group_status
import load_test_runner
from job_store import init_db, list_jobs, list_job_groups, set_baseline, get_baseline_id, mark_interrupted_runs

def _env_flag(name, default="false"):
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


def _allowed_origins():
    """Browser origins allowed to call the API (CORS). Comma-separated in
    CORS_ALLOWED_ORIGINS; defaults to the Vite dev server."""
    raw = os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    return [o.strip() for o in raw.split(",") if o.strip()]


app = Flask(__name__)
CORS(app, origins=_allowed_origins())
init_db()

# Runs left "queued" or "running" by a previous backend process can never
# finish (their threads and Locust processes died with it): mark them
# "interrupted". Not in queue mode, where a remote worker may still be running
# them; RECOVER_STALE_RUNS=false turns it off (the test suite does, so it never
# touches a developer's database).
if not load_test_runner.USE_SQS and _env_flag("RECOVER_STALE_RUNS", "true"):
    _interrupted = mark_interrupted_runs()
    if any(_interrupted.values()):
        app.logger.warning("Marked runs from a previous process as interrupted: %s", _interrupted)

MAX_USERS = 1000
MAX_DURATION_SECONDS = 300
MAX_SPAWN_RATE = 20
MAX_REPEAT = 5


@app.errorhandler(Exception)
def handle_uncaught_exception(e):
    app.logger.exception("Unhandled exception")
    return jsonify({"error": "internal_server_error", "detail": str(e)}), 500


@app.errorhandler(404)
def handle_404(e):
    return jsonify({"error": "not_found"}), 404


@app.route("/api/health", methods=["GET"])
def health_endpoint():
    return jsonify({"status": "ok"}), 200


@app.route("/health", methods=["GET"])
def health_alias_endpoint():
    return jsonify({"status": "ok"}), 200


def _blocked_target(url):
    """A 400 response when the target guard refuses url, else None."""
    if not urlparse(url).hostname:
        return None  # malformed URLs are reported by the endpoints themselves
    problem = check_target(url)
    if problem:
        return jsonify({"error": f"Target not allowed: {problem}", "blocked_target": True}), 400
    return None


@app.route("/api/sanity-check", methods=["POST"])
def sanity_check_endpoint():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "url is required"}), 400
    blocked = _blocked_target(url)
    if blocked:
        return blocked
    result = sanity_check(url)
    status_code = 200 if result["valid_format"] else 400
    return jsonify(result), status_code


@app.route("/api/analyze", methods=["POST"])
def analyze_endpoint():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "url is required"}), 400
    # Optional request headers (e.g. Authorization) for the probe.
    headers, err = clean_headers(data.get("headers"))
    if err:
        return jsonify({"error": err}), 400
    blocked = _blocked_target(url)
    if blocked:
        return blocked

    sanity = sanity_check(url, headers=headers)
    if not sanity["valid_format"] or not sanity.get("reachable"):
        body = {"sanity": sanity}
        if sanity.get("blocked"):
            body["error"] = sanity["error"]
            body["blocked_target"] = True
        return jsonify(body), 400

    type_result = detect_type(sanity["final_url"], sanity["headers"], sanity.get("attempts"))
    response = {"sanity": sanity, "type_detection": type_result}

    if type_result["classification"] == "website":
        response["sitemap"] = try_find_sitemap(sanity["final_url"])

    return jsonify(response), 200


@app.route("/api/generate-edge-cases", methods=["POST"])
def generate_edge_cases_endpoint():
    data = request.get_json(silent=True) or {}
    sample_input = data.get("sample_input")
    if not sample_input or not isinstance(sample_input, dict):
        return jsonify({"error": "sample_input (object) is required"}), 400
    cases = generate_edge_cases(sample_input)
    return jsonify({"total_cases": len(cases), "cases": cases}), 200


@app.route("/api/validate-custom-case", methods=["POST"])
def validate_custom_case_endpoint():
    data = request.get_json(silent=True) or {}
    sample_input = data.get("sample_input")
    if not sample_input or not isinstance(sample_input, dict):
        return jsonify({"error": "sample_input (object) is required"}), 400
    result = classify_custom_case(sample_input, data.get("payload"), data.get("label") or "")
    return jsonify(result), 200


@app.route("/api/confirm-selection", methods=["POST"])
def confirm_selection_endpoint():
    data = request.get_json(silent=True) or {}
    sample_input = data.get("sample_input")
    selected_labels = data.get("selected_labels")
    # Optional list of {"label", "payload", "expect"?} written by the user.
    custom_cases = data.get("custom_cases")
    # Optional {label: "accept" | "reject"} overrides for generated cases
    # (e.g. a field the API treats as optional).
    expectations = data.get("expectations") or {}

    if not sample_input or not isinstance(sample_input, dict):
        return jsonify({"error": "sample_input (object) is required"}), 400
    if custom_cases is not None and not isinstance(custom_cases, list):
        return jsonify({"error": "custom_cases must be a list"}), 400
    if custom_cases:
        # With custom cases, selecting no generated case is allowed.
        selected_labels = [] if selected_labels is None else selected_labels
        if not isinstance(selected_labels, list):
            return jsonify({"error": "selected_labels (list) is required"}), 400
    elif not selected_labels or not isinstance(selected_labels, list):
        return jsonify({"error": "selected_labels (list) is required"}), 400
    if not isinstance(expectations, dict) or any(v not in EXPECTATIONS for v in expectations.values()):
        return jsonify({"error": 'expectations must map case labels to "accept" or "reject"'}), 400

    all_cases = generate_edge_cases(sample_input)
    label_set = set(selected_labels)
    selected_cases = [c for c in all_cases if c["label"] in label_set]

    missing = label_set - {c["label"] for c in all_cases}
    if missing:
        return jsonify({"error": f"Unknown labels: {sorted(missing)}"}), 400
    for case in selected_cases:
        if case["label"] in expectations:
            case["expect"] = expectations[case["label"]]

    # Custom cases are re-validated here: the browser's earlier check is not trusted.
    used_labels = {c["label"] for c in selected_cases}
    for custom in custom_cases or []:
        if not isinstance(custom, dict):
            return jsonify({"error": "each custom case must be an object"}), 400
        label, payload = custom.get("label"), custom.get("payload")
        result = classify_custom_case(sample_input, payload, label if label is not None else "")
        if not result["valid"]:
            return jsonify({"error": f"Custom case '{label}': {result['reason']}"}), 400
        if label in used_labels:
            return jsonify({"error": f"Custom case '{label}': label used twice"}), 400
        # A custom case is usually something the API should refuse.
        expect = custom.get("expect", EXPECT_REJECT)
        if expect not in EXPECTATIONS:
            return jsonify({"error": f'Custom case \'{label}\': expect must be "accept" or "reject"'}), 400
        used_labels.add(label)
        selected_cases.append({
            "label": label,
            "category": "custom",
            "classified_as": result["category"],
            "description": result["description"],
            "payload": payload,
            "expect": expect,
        })

    if not selected_cases:
        return jsonify({"error": "No cases matched the selected labels"}), 400

    return jsonify({"confirmed_count": len(selected_cases), "confirmed_cases": selected_cases}), 200


def _validate_load_test_params(data):
    try:
        users = int(data.get("users", 5))
        spawn_rate = int(data.get("spawn_rate", 1))
        duration_seconds = int(data.get("duration_seconds", 30))
    except (TypeError, ValueError):
        return None, ("users, spawn_rate, duration_seconds must be integers", 400)

    if not (1 <= users <= MAX_USERS):
        return None, (f"users must be between 1 and {MAX_USERS}", 400)
    if not (1 <= spawn_rate <= MAX_SPAWN_RATE):
        return None, (f"spawn_rate must be between 1 and {MAX_SPAWN_RATE}", 400)
    if not (1 <= duration_seconds <= MAX_DURATION_SECONDS):
        return None, (f"duration_seconds must be between 1 and {MAX_DURATION_SECONDS}", 400)

    return (users, spawn_rate, duration_seconds), None


# ---- At most MAX_ACTIVE_RUNS load tests at a time ------------------------------

_start_lock = threading.Lock()


def _max_active_runs():
    """MAX_ACTIVE_RUNS, read at call time (default 1; at least 1)."""
    try:
        return max(1, int(os.environ.get("MAX_ACTIVE_RUNS", "1")))
    except ValueError:
        return 1


def _one_start_at_a_time(view):
    """Start requests run one after another, so the active-run check and the
    creation of the new run cannot interleave between two requests."""
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        with _start_lock:
            return view(*args, **kwargs)
    return wrapped


def _busy_response():
    """A 429 when MAX_ACTIVE_RUNS load tests are already queued or running
    (a split group, a capacity run or a repeat series counts as one)."""
    limit = _max_active_runs()
    active = load_test_runner.active_run_count()
    if active < limit:
        return None
    running = "A load test is" if active == 1 else f"{active} load tests are"
    return jsonify({
        "error": f"{running} already running, and this server runs at most {limit} at a time. "
                 "Wait for it to finish (or stop it), then start again.",
        "busy": True,
        "active_runs": active,
        "max_active_runs": limit,
    }), 429


def _start_refusal(data, target_url):
    """Checks shared by both start endpoints: the user must confirm they may
    load-test the target, and the target guard must allow it."""
    if data.get("i_own_target") is not True:
        return jsonify({
            "error": "Confirm that you own this target or have permission to load-test it "
                     "(send \"i_own_target\": true).",
            "missing_confirmation": "i_own_target",
        }), 400
    return _blocked_target(target_url)


def _start_capacity(job_type, data, host, headers, slo, meta, repeat, **targets):
    """mode "capacity": a step-load run judged step by step against the SLO
    (analysis/capacity.py). Always one job, never split."""
    if data.get("mode") != "capacity":
        return jsonify({"error": 'mode must be "fixed" or "capacity"'}), 400
    if load_test_runner.USE_SQS:
        return jsonify({"error": "Capacity runs are not available in queue (SQS) mode."}), 409
    if repeat > 1:
        return jsonify({"error": "repeat cannot be combined with a capacity run"}), 400
    plan, err = clean_capacity(data.get("capacity"))
    if err:
        return jsonify({"error": err}), 400
    if not step_slo(slo):
        return jsonify({"error": "A capacity run needs an SLO to judge each step: set p95_ms, avg_ms, "
                                 "max_server_error_rate_pct or max_unexpected_outcome_rate_pct."}), 400
    params, err = _validate_load_test_params(data)
    if err:
        return jsonify({"error": err[0]}), err[1]
    spawn_rate = params[1]
    problem = ramp_problem(plan, spawn_rate)
    if problem:
        return jsonify({"error": problem}), 400
    meta = {**meta, "mode": "capacity", "capacity_plan": plan}
    job_id = load_test_runner.start_capacity_test(job_type, host, plan, spawn_rate, slo, headers=headers,
                                                  meta=meta, **targets)
    return jsonify({"job_id": job_id, "status": "started", "is_group": False, "mode": "capacity",
                    "capacity_plan": plan}), 202


def _repeat_count(data):
    """Optional "repeat" (1-5, default 1), or (None, (error, status))."""
    try:
        repeat = int(data.get("repeat", 1))
    except (TypeError, ValueError):
        return None, ("repeat must be an integer", 400)
    if not 1 <= repeat <= MAX_REPEAT:
        return None, (f"repeat must be between 1 and {MAX_REPEAT}", 400)
    return repeat, None


def _series_started(job_type, host, users, spawn_rate, duration_seconds, repeat, headers, start_one, extra):
    """Starts a repeat series and builds the 202 response. The series id is
    returned as job_id too, so the browser polls it like any other run."""
    series_id = load_test_runner.start_series(job_type, host, users, spawn_rate, duration_seconds, repeat,
                                              start_one, header_names=header_names(headers))
    body = {"job_id": series_id, "series_id": series_id, "status": "started",
            "is_group": users > load_test_runner.SPLIT_THRESHOLD, "is_series": True, "repeat": repeat}
    body.update(extra)
    return jsonify(body), 202


def _request_headers(data):
    """Validated optional headers for a load test, or (None, (error, status))."""
    headers, err = clean_headers(data.get("headers"))
    if err:
        return None, (err, 400)
    if headers and load_test_runner.USE_SQS:
        # The queue message would carry the values to another machine and
        # keep them until processed; refuse rather than store secrets there.
        return None, ("Request headers are not supported in queue (SQS) mode.", 409)
    return headers, None


@app.route("/api/start-load-test", methods=["POST"])
@_one_start_at_a_time
def start_load_test_endpoint():
    data = request.get_json(silent=True) or {}
    target_url = data.get("url")
    confirmed_cases = data.get("confirmed_cases")

    if not target_url or not isinstance(target_url, str):
        return jsonify({"error": "url (string) is required"}), 400
    if not confirmed_cases or not isinstance(confirmed_cases, list):
        return jsonify({"error": "confirmed_cases (non-empty list) is required"}), 400
    for case in confirmed_cases:
        if isinstance(case, dict) and "expect" in case and case["expect"] not in EXPECTATIONS:
            return jsonify({"error": f"case '{case.get('label')}': expect must be \"accept\" or \"reject\""}), 400
    refused = _start_refusal(data, target_url)
    if refused:
        return refused

    params, err = _validate_load_test_params(data)
    if err:
        return jsonify({"error": err[0]}), err[1]
    users, spawn_rate, duration_seconds = params
    headers, err = _request_headers(data)
    if err:
        return jsonify({"error": err[0]}), err[1]
    repeat, err = _repeat_count(data)
    if err:
        return jsonify({"error": err[0]}), err[1]
    slo, err = clean_slo(data.get("slo"))
    if err:
        return jsonify({"error": err}), 400

    parsed = urlparse(target_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return jsonify({"error": "url must be a valid http(s) URL"}), 400

    host = f"{parsed.scheme}://{parsed.netloc}"
    path = parsed.path or "/"
    meta = {"case_expectations": load_test_runner.case_expectations(confirmed_cases), "slo": slo}

    busy = _busy_response()
    if busy:
        return busy

    if data.get("mode", "fixed") != "fixed":
        return _start_capacity("api", data, host, headers, slo, meta, repeat,
                               target_path=path, cases=confirmed_cases)

    if repeat > 1:
        return _series_started(
            "api", host, users, spawn_rate, duration_seconds, repeat, headers,
            lambda: start_load_test(host, path, confirmed_cases, users, spawn_rate, duration_seconds,
                                    headers=headers, meta=meta),
            {},
        )

    job_id, is_group = start_load_test(host, path, confirmed_cases, users, spawn_rate, duration_seconds,
                                       headers=headers, meta=meta)
    return jsonify({"job_id": job_id, "status": "started", "is_group": is_group}), 202


@app.route("/api/start-website-load-test", methods=["POST"])
@_one_start_at_a_time
def start_website_load_test_endpoint():
    data = request.get_json(silent=True) or {}
    target_url = data.get("url")
    sitemap_raw = data.get("sitemap_raw")

    if not target_url or not isinstance(target_url, str):
        return jsonify({"error": "url (string) is required"}), 400
    refused = _start_refusal(data, target_url)
    if refused:
        return refused

    params, err = _validate_load_test_params(data)
    if err:
        return jsonify({"error": err[0]}), err[1]
    users, spawn_rate, duration_seconds = params
    headers, err = _request_headers(data)
    if err:
        return jsonify({"error": err[0]}), err[1]
    repeat, err = _repeat_count(data)
    if err:
        return jsonify({"error": err[0]}), err[1]
    slo, err = clean_slo(data.get("slo"))
    if err:
        return jsonify({"error": err}), 400
    meta = {"slo": slo}

    parsed = urlparse(target_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return jsonify({"error": "url must be a valid http(s) URL"}), 400

    host = f"{parsed.scheme}://{parsed.netloc}"

    paths = []
    if sitemap_raw:
        paths = extract_paths_from_sitemap(sitemap_raw)
    if not paths:
        paths = [parsed.path or "/"]

    busy = _busy_response()
    if busy:
        return busy

    if data.get("mode", "fixed") != "fixed":
        return _start_capacity("website", data, host, headers, slo, meta, repeat, paths=paths)

    if repeat > 1:
        return _series_started(
            "website", host, users, spawn_rate, duration_seconds, repeat, headers,
            lambda: start_website_load_test(host, paths, users, spawn_rate, duration_seconds, headers=headers,
                                            meta=meta),
            {"paths_used": paths},
        )

    job_id, is_group = start_website_load_test(host, paths, users, spawn_rate, duration_seconds,
                                               headers=headers, meta=meta)
    return jsonify({"job_id": job_id, "status": "started", "is_group": is_group, "paths_used": paths}), 202


def _with_failure_summary(run):
    """Adds failure_summary (failures grouped by HTTP status) to a job or
    group status dict. Groups carry merged failures, single jobs their own."""
    run["failure_summary"] = summarize_failures(
        run.get("aggregated_failures_csv") or run.get("failures_csv")
    )
    # Stored as a JSON list of names; values are never stored.
    if isinstance(run.get("header_names"), str):
        run["header_names"] = json.loads(run["header_names"])
    # problem_count / problem_rate: 5xx + 429 + connection failures only.
    run.update(problem_rate(run["failure_summary"], _stats_of(run)))
    # Expected outcomes: {label: "accept" | "reject"} and how requests matched.
    expectations = _json_field(run, "case_expectations")
    run["case_expectations"] = expectations
    run["outcome_summary"] = outcome_summary(run["failure_summary"], _stats_of(run), expectations)
    # SLO thresholds and, once the run completed, the PASS / FAIL verdict.
    run["slo"] = _json_field(run, "slo")
    run["mode"] = _json_field(run, "mode") or "fixed"
    run["capacity_plan"] = _json_field(run, "capacity_plan")
    run["capacity"] = None
    if run["mode"] == "capacity":
        # Judged step by step, not as a whole (the last steps are meant to
        # overload the target, so a whole-run verdict would always fail).
        run["slo_verdict"] = None
        history = run.get("history_csv")
        if run["capacity_plan"] and history:
            run["capacity"] = capacity_result(history, run["capacity_plan"], run["slo"],
                                              _json_field(run, "capacity_steps"))
        return run
    run["slo_verdict"] = (
        evaluate_slo(run["slo"], run_metrics(_stats_of(run), run["failure_summary"], run["outcome_summary"]))
        if run["slo"] and run.get("status") == "completed" else None
    )
    return run


def _json_field(run, name):
    value = run.get(name)
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return None
    return value


def _series_status(series):
    """A repeat series as the status endpoint returns it: its own status,
    each repeat's id and status, and, once it has stopped, the statistics
    across the repeats that completed."""
    runs = []
    finished = []
    for run_id in series["run_ids"]:
        run = _find_run(run_id)
        if run is None:
            continue
        run = _with_failure_summary(run)
        runs.append({"id": run_id, "status": run["status"], "is_group": "child_jobs" in run,
                     "slo_verdict": (run.get("slo_verdict") or {}).get("verdict"),
                     "problem_rate": run.get("problem_rate")})
        if run["status"] == "completed":
            finished.append({"stats_csv": _stats_of(run), "problem_rate": run.get("problem_rate")})
    series["runs"] = runs
    series["series_summary"] = (
        summarize_series(finished)
        if series["status"] in load_test_runner.TERMINAL_STATUSES and finished
        else None
    )
    return series


@app.route("/api/load-test-status/<job_id>", methods=["GET"])
def load_test_status_endpoint(job_id):
    # A repeat series is polled through the same endpoint as a single run.
    series = get_series(job_id)
    if series is not None:
        return jsonify(_series_status(series)), 200

    # A split job's id is a group_id, not a single job_id — check that first.
    group_status = get_group_status(job_id)
    if group_status is not None:
        return jsonify(_with_failure_summary(group_status)), 200

    status = get_job_status(job_id)
    if status is None:
        return jsonify({"error": "job_id not found"}), 404
    return jsonify(_with_failure_summary(status)), 200


@app.route("/api/cancel/<run_id>", methods=["POST"])
def cancel_endpoint(run_id):
    """Stops a running job, a whole split group, or a repeat series. The
    status turns "cancelled" once the Locust process has exited."""
    if load_test_runner.USE_SQS:
        return jsonify({"error": "Stopping a test is not available in queue (SQS) mode: the "
                                 "worker runs on another machine, so this server cannot "
                                 "reach its Locust process."}), 409
    if not load_test_runner.cancel_run(run_id):
        return jsonify({"error": f"run '{run_id}' not found"}), 404
    return jsonify({"id": run_id, "status": "cancelling"}), 202


@app.route("/api/jobs", methods=["GET"])
def list_jobs_endpoint():
    jobs = [_with_list_verdict(r, r["job_id"]) for r in list_jobs()]
    groups = []
    for row in list_job_groups():
        if row["status"] in ("queued", "running"):
            # A group's stored status may lag behind its children; this
            # refreshes (and persists) it from them.
            row["status"] = get_group_status(row["group_id"])["status"]
        groups.append(_with_list_verdict(row, row["group_id"]))
    return jsonify({"jobs": jobs, "job_groups": groups}), 200


def _with_list_verdict(row, run_id):
    """Adds slo (decoded) and slo_verdict ("PASS" / "FAIL" / None) to a
    history row. The verdict needs the run's results, so it is computed only
    for completed runs that have an SLO."""
    row["slo"] = _json_field(row, "slo")
    row["mode"] = _json_field(row, "mode") or "fixed"
    row["slo_verdict"] = None
    if row["slo"] and row.get("status") == "completed":
        run = _find_run(run_id)
        if run is not None:
            verdict = _with_failure_summary(run)["slo_verdict"]
            row["slo_verdict"] = verdict and verdict["verdict"]
    return row


def _find_run(run_id):
    """A run id is either a split group's id or a single job's id."""
    return get_group_status(run_id) or get_job_status(run_id)


def _compare_many(job_ids):
    if (not isinstance(job_ids, list) or not 2 <= len(job_ids) <= 4
            or not all(isinstance(i, str) and i for i in job_ids)):
        return jsonify({"error": "job_ids must be a list of 2 to 4 run ids"}), 400

    runs = []
    for run_id in job_ids:
        run = _find_run(run_id)
        if run is None:
            return jsonify({"error": f"run '{run_id}' not found"}), 404
        runs.append(_with_failure_summary(run))

    case_comparison = compare_cases(
        [run.get("aggregated_stats_csv") or run.get("stats_csv") for run in runs]
    )
    return jsonify({"jobs": runs, "case_comparison": case_comparison}), 200


@app.route("/api/compare-jobs", methods=["POST"])
def compare_jobs_endpoint():
    data = request.get_json(silent=True) or {}
    # New form: {"job_ids": [...]} with 2-4 runs. The original
    # job_id_a/job_id_b form below is kept unchanged.
    if "job_ids" in data:
        return _compare_many(data["job_ids"])

    job_id_a = data.get("job_id_a")
    job_id_b = data.get("job_id_b")

    if not job_id_a or not job_id_b:
        return jsonify({"error": "job_id_a and job_id_b are required"}), 400

    job_a = get_group_status(job_id_a) or get_job_status(job_id_a)
    job_b = get_group_status(job_id_b) or get_job_status(job_id_b)

    if job_a is None:
        return jsonify({"error": f"job_id_a '{job_id_a}' not found"}), 404
    if job_b is None:
        return jsonify({"error": f"job_id_b '{job_id_b}' not found"}), 404

    return jsonify({"job_a": _with_failure_summary(job_a), "job_b": _with_failure_summary(job_b)}), 200


def _stats_of(run):
    return run.get("aggregated_stats_csv") or run.get("stats_csv")


@app.route("/api/baseline", methods=["POST"])
def set_baseline_endpoint():
    data = request.get_json(silent=True) or {}
    run_id = data.get("id")
    if not run_id or not isinstance(run_id, str):
        return jsonify({"error": "id (string) is required"}), 400
    run = _find_run(run_id)
    if run is None:
        return jsonify({"error": f"run '{run_id}' not found"}), 404
    if run.get("status") != "completed":
        return jsonify({"error": "only a completed run can be the baseline"}), 400
    set_baseline(run_id, run["target_url"])
    return jsonify({"baseline_id": run_id, "target_url": run["target_url"]}), 200


@app.route("/api/baseline", methods=["GET"])
def get_baseline_endpoint():
    target_url = request.args.get("target_url")
    if not target_url:
        return jsonify({"error": "target_url query parameter is required"}), 400
    return jsonify({"target_url": target_url, "baseline_id": get_baseline_id(target_url)}), 200


@app.route("/api/regressions/<run_id>", methods=["GET"])
def regressions_endpoint(run_id):
    """Compares a run with the baseline of its target, if there is one."""
    run = _find_run(run_id)
    if run is None:
        return jsonify({"error": f"run '{run_id}' not found"}), 404

    # Optional ?baseline_id=<id> compares with that run instead of the
    # target's stored baseline (used by scripts/regression_gate.py).
    baseline_id = request.args.get("baseline_id")
    if baseline_id:
        if _find_run(baseline_id) is None:
            return jsonify({"error": f"baseline run '{baseline_id}' not found"}), 404
    else:
        baseline_id = get_baseline_id(run["target_url"])
    response = {
        "target_url": run["target_url"],
        "baseline_id": baseline_id,
        "is_current_baseline": baseline_id == run_id,
        "baseline": None,
    }
    if baseline_id and baseline_id != run_id:
        baseline = _find_run(baseline_id)
        if baseline is not None:
            response["baseline"] = {
                "id": baseline_id,
                "users": baseline.get("users"),
                "created_at": baseline.get("created_at"),
                "is_group": "job_id" not in baseline,
            }
            response.update(detect_regressions(_stats_of(baseline), _stats_of(run)))
    return jsonify(response), 200


if __name__ == "__main__":
    # Local development server. Debug mode (reloader + interactive debugger,
    # which can run arbitrary code) is opt-in with FLASK_DEBUG=1, and it
    # listens on 127.0.0.1 unless HOST says otherwise. Containers run
    # gunicorn instead (see Dockerfile).
    app.run(
        debug=_env_flag("FLASK_DEBUG"),
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "5000")),
    )