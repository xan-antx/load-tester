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
from load_test_runner import start_load_test, start_website_load_test, get_job_status, get_group_status
from job_store import init_db, list_jobs, list_job_groups, set_baseline, get_baseline_id

app = Flask(__name__)
CORS(app)
init_db()

MAX_USERS = 1000
MAX_DURATION_SECONDS = 300
MAX_SPAWN_RATE = 20


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


@app.route("/api/sanity-check", methods=["POST"])
def sanity_check_endpoint():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "url is required"}), 400
    result = sanity_check(url)
    status_code = 200 if result["valid_format"] else 400
    return jsonify(result), status_code


@app.route("/api/analyze", methods=["POST"])
def analyze_endpoint():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "url is required"}), 400

    sanity = sanity_check(url)
    if not sanity["valid_format"] or not sanity.get("reachable"):
        return jsonify({"sanity": sanity}), 400

    type_result = detect_type(sanity["final_url"], sanity["headers"])
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
    # Optional list of {"label", "payload"} written by the user.
    custom_cases = data.get("custom_cases")

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

    all_cases = generate_edge_cases(sample_input)
    label_set = set(selected_labels)
    selected_cases = [c for c in all_cases if c["label"] in label_set]

    missing = label_set - {c["label"] for c in all_cases}
    if missing:
        return jsonify({"error": f"Unknown labels: {sorted(missing)}"}), 400

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
        used_labels.add(label)
        selected_cases.append({
            "label": label,
            "category": "custom",
            "classified_as": result["category"],
            "description": result["description"],
            "payload": payload,
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


@app.route("/api/start-load-test", methods=["POST"])
def start_load_test_endpoint():
    data = request.get_json(silent=True) or {}
    target_url = data.get("url")
    confirmed_cases = data.get("confirmed_cases")

    if not target_url or not isinstance(target_url, str):
        return jsonify({"error": "url (string) is required"}), 400
    if not confirmed_cases or not isinstance(confirmed_cases, list):
        return jsonify({"error": "confirmed_cases (non-empty list) is required"}), 400

    params, err = _validate_load_test_params(data)
    if err:
        return jsonify({"error": err[0]}), err[1]
    users, spawn_rate, duration_seconds = params

    parsed = urlparse(target_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return jsonify({"error": "url must be a valid http(s) URL"}), 400

    host = f"{parsed.scheme}://{parsed.netloc}"
    path = parsed.path or "/"

    job_id, is_group = start_load_test(host, path, confirmed_cases, users, spawn_rate, duration_seconds)
    return jsonify({"job_id": job_id, "status": "started", "is_group": is_group}), 202


@app.route("/api/start-website-load-test", methods=["POST"])
def start_website_load_test_endpoint():
    data = request.get_json(silent=True) or {}
    target_url = data.get("url")
    sitemap_raw = data.get("sitemap_raw")

    if not target_url or not isinstance(target_url, str):
        return jsonify({"error": "url (string) is required"}), 400

    params, err = _validate_load_test_params(data)
    if err:
        return jsonify({"error": err[0]}), err[1]
    users, spawn_rate, duration_seconds = params

    parsed = urlparse(target_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return jsonify({"error": "url must be a valid http(s) URL"}), 400

    host = f"{parsed.scheme}://{parsed.netloc}"

    paths = []
    if sitemap_raw:
        paths = extract_paths_from_sitemap(sitemap_raw)
    if not paths:
        paths = [parsed.path or "/"]

    job_id, is_group = start_website_load_test(host, paths, users, spawn_rate, duration_seconds)
    return jsonify({"job_id": job_id, "status": "started", "is_group": is_group, "paths_used": paths}), 202


def _with_failure_summary(run):
    """Adds failure_summary (failures grouped by HTTP status) to a job or
    group status dict. Groups carry merged failures, single jobs their own."""
    run["failure_summary"] = summarize_failures(
        run.get("aggregated_failures_csv") or run.get("failures_csv")
    )
    return run


@app.route("/api/load-test-status/<job_id>", methods=["GET"])
def load_test_status_endpoint(job_id):
    # A split job's id is a group_id, not a single job_id — check that first.
    group_status = get_group_status(job_id)
    if group_status is not None:
        return jsonify(_with_failure_summary(group_status)), 200

    status = get_job_status(job_id)
    if status is None:
        return jsonify({"error": "job_id not found"}), 404
    return jsonify(_with_failure_summary(status)), 200


@app.route("/api/jobs", methods=["GET"])
def list_jobs_endpoint():
    return jsonify({"jobs": list_jobs(), "job_groups": list_job_groups()}), 200


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
    app.run(debug=True, host="0.0.0.0", port=5000)