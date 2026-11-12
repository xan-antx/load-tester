"""SLO thresholds: validation, metrics, verdicts, and the endpoints."""
import pytest

import job_store
import load_test_runner
from analysis.slo import clean_slo, evaluate_slo, run_metrics
from app import app

STATS = ("Type,Name,Request Count,Failure Count,Average Response Time,Requests/s,95%\n"
         "POST,a,200,10,120,10,300\n,Aggregated,200,10,120.5,10.4,300\n")
SUMMARY = [{"kind": "server_error", "total": 3}, {"kind": "connection", "total": 1},
           {"kind": "accepted_invalid_input", "total": 6}]
OUTCOMES = {"unexpected_outcome_rate_pct": 3.0}


# ---- validation ------------------------------------------------------------------

def test_clean_slo_keeps_given_thresholds():
    slo, err = clean_slo({"p95_ms": 500, "max_server_error_rate_pct": 1, "min_rps": None})
    assert err is None and slo == {"p95_ms": 500, "max_server_error_rate_pct": 1}


@pytest.mark.parametrize("raw", [None, {}, {"p95_ms": None}])
def test_no_slo(raw):
    assert clean_slo(raw) == (None, None)


@pytest.mark.parametrize("raw, word", [
    ({"p95_ms": 0}, "between"),
    ({"p95_ms": 700_000}, "between"),
    ({"max_server_error_rate_pct": 101}, "between"),
    ({"max_unexpected_outcome_rate_pct": -1}, "between"),
    ({"min_rps": "fast"}, "number"),
    ({"avg_ms": True}, "number"),
    ({"p99_ms": 100}, "unknown"),
    ([500], "object"),
])
def test_bad_slo_is_rejected(raw, word):
    slo, err = clean_slo(raw)
    assert slo is None and word in err


# ---- metrics and verdicts --------------------------------------------------------------

def test_run_metrics():
    m = run_metrics(STATS, SUMMARY, OUTCOMES)
    assert m == {"p95_ms": 300.0, "avg_ms": 120.5, "rps": 10.4,
                 "server_error_rate_pct": 2.0, "unexpected_outcome_rate_pct": 3.0}


def test_pass_when_every_threshold_holds():
    v = evaluate_slo({"p95_ms": 500, "max_server_error_rate_pct": 5, "min_rps": 5},
                     run_metrics(STATS, SUMMARY, OUTCOMES))
    assert v["verdict"] == "PASS" and v["passed"] == 3 and v["failed"] == 0
    p95 = v["checks"][0]
    assert p95 == {"key": "p95_ms", "label": "p95 response time", "unit": "ms", "comparison": "<=",
                   "target": 500, "actual": 300.0, "passed": True}


def test_fail_when_any_threshold_is_missed():
    v = evaluate_slo({"p95_ms": 250, "max_server_error_rate_pct": 1, "min_rps": 20, "avg_ms": 200},
                     run_metrics(STATS, SUMMARY, OUTCOMES))
    assert v["verdict"] == "FAIL"
    assert {c["key"]: c["passed"] for c in v["checks"]} == {
        "p95_ms": False, "avg_ms": True, "max_server_error_rate_pct": False, "min_rps": False}
    assert v["failed"] == 3


def test_boundaries_are_inclusive():
    v = evaluate_slo({"p95_ms": 300, "min_rps": 10.4}, run_metrics(STATS, SUMMARY))
    assert v["verdict"] == "PASS"


def test_unexpected_rate_not_measured_without_expectations():
    v = evaluate_slo({"max_unexpected_outcome_rate_pct": 1, "p95_ms": 500}, run_metrics(STATS, SUMMARY, None))
    unexpected = next(c for c in v["checks"] if c["key"] == "max_unexpected_outcome_rate_pct")
    assert unexpected["passed"] is None and unexpected["actual"] is None
    assert v["verdict"] == "PASS" and v["not_measured"] == 1


def test_nothing_measurable_gives_no_verdict():
    v = evaluate_slo({"max_unexpected_outcome_rate_pct": 1}, run_metrics(None, [], None))
    assert v["verdict"] is None


def test_no_slo_no_verdict():
    assert evaluate_slo(None, run_metrics(STATS, SUMMARY)) is None


# ---- endpoints -------------------------------------------------------------------------

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(job_store, "DB_PATH", str(tmp_path / "test.db"))
    job_store.init_db()
    monkeypatch.setattr(load_test_runner, "_dispatch_single", lambda *a, **k: None)
    return app.test_client()


CASES = [{"label": "a", "payload": {"x": 1}, "expect": "reject"}]


def _start(client, users=10, slo=None, path="/api/start-load-test"):
    body = {"url": "http://127.0.0.1:8000/api/login", "confirmed_cases": CASES, "users": users,
            "spawn_rate": 1, "duration_seconds": 5, "i_own_target": True}
    if slo is not None:
        body["slo"] = slo
    return client.post(path, json=body)


def _finish(run_id, stats=STATS, failures=None):
    if job_store.get_job_group(run_id):
        for child in job_store.list_child_jobs(run_id):
            job_store.update_job(child["job_id"], status="completed", stats_csv=stats, failures_csv=failures)
    else:
        job_store.update_job(run_id, status="completed", stats_csv=stats, failures_csv=failures)


@pytest.mark.parametrize("users", [10, 120])  # single and split runs
def test_verdict_in_status_and_jobs_list(client, users):
    run_id = _start(client, users, slo={"p95_ms": 500, "min_rps": 1}).get_json()["job_id"]
    running = client.get(f"/api/load-test-status/{run_id}").get_json()
    assert running["slo"] == {"p95_ms": 500, "min_rps": 1} and running["slo_verdict"] is None
    _finish(run_id)
    status = client.get(f"/api/load-test-status/{run_id}").get_json()
    assert status["slo_verdict"]["verdict"] == "PASS"
    listing = client.get("/api/jobs").get_json()
    row = next(r for r in listing["jobs"] + listing["job_groups"] if (r.get("job_id") or r.get("group_id")) == run_id)
    assert row["slo_verdict"] == "PASS"


def test_failing_verdict_in_compare(client):
    a = _start(client, slo={"p95_ms": 100}).get_json()["job_id"]
    b = _start(client).get_json()["job_id"]
    _finish(a)
    _finish(b)
    jobs = client.post("/api/compare-jobs", json={"job_ids": [a, b]}).get_json()["jobs"]
    assert jobs[0]["slo_verdict"]["verdict"] == "FAIL"
    assert jobs[1]["slo_verdict"] is None


def test_website_runs_accept_an_slo(client):
    resp = client.post("/api/start-website-load-test", json={
        "url": "http://127.0.0.1:8000/", "users": 2, "spawn_rate": 1, "duration_seconds": 5,
        "i_own_target": True, "slo": {"p95_ms": 800},
    })
    assert resp.status_code == 202
    status = client.get(f"/api/load-test-status/{resp.get_json()['job_id']}").get_json()
    assert status["slo"] == {"p95_ms": 800}


@pytest.mark.parametrize("path", ["/api/start-load-test", "/api/start-website-load-test"])
def test_invalid_slo_is_rejected_by_both_endpoints(client, path):
    resp = _start(client, slo={"p95_ms": -5}, path=path)
    assert resp.status_code == 400 and "slo.p95_ms" in resp.get_json()["error"]


def test_old_databases_gain_the_slo_column(tmp_path, monkeypatch):
    import sqlite3
    db = tmp_path / "old.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE jobs (job_id TEXT PRIMARY KEY, target_url TEXT, users INTEGER, spawn_rate INTEGER,"
                 " duration_seconds INTEGER, status TEXT, stats_csv TEXT, stdout TEXT, stderr TEXT, error TEXT,"
                 " created_at TEXT DEFAULT CURRENT_TIMESTAMP, completed_at TEXT)")
    conn.execute("INSERT INTO jobs (job_id, status) VALUES ('old', 'completed')")
    conn.commit()
    conn.close()
    monkeypatch.setattr(job_store, "DB_PATH", str(db))
    job_store.init_db()
    job_store.init_db()  # running twice is safe
    assert job_store.get_job("old")["slo"] is None
