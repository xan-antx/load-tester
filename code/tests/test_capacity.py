"""Capacity finder: plan validation, step metrics from synthetic history,
verdicts, run-time snapshots, the endpoints and the runner wiring."""
import json
import os
import subprocess

import pytest

import job_store
import load_test_runner
from analysis.capacity import (
    capacity_result, clean_capacity, error_kind, plan_steps, record_rates, snapshot, step_metrics,
    step_record, step_slo,
)
from app import app

HEADER = ("Timestamp,User Count,Type,Name,Requests/s,Failures/s,95%,"
          "Total Request Count,Total Failure Count,Total Average Response Time\n")


def history(seconds):
    """seconds: list of (users, requests in that second, failures in that
    second, avg ms of that second, rolling p95) -> a history CSV."""
    lines, total, fails, time_sum = [], 0, 0, 0.0
    t0 = 1_800_000_000
    lines.append(f"{t0},0,,Aggregated,0,0,N/A,0,0,0.0")
    for i, (users, req, fail, avg, p95) in enumerate(seconds, start=1):
        total += req
        fails += fail
        time_sum += req * avg
        lines.append(f"{t0 + i},{users},,Aggregated,{req},{fail},{p95},{total},{fails},{time_sum / total if total else 0}")
    return HEADER + "\n".join(lines) + "\n"


PLAN = {"steps": [10, 20, 30], "step_duration_seconds": 5}
# Second 0 is the t0 row; step 0 = seconds 0-4, step 1 = 5-9, step 2 = 10-14.
CLIMB = history(
    [(10, 8, 0, 100, 120)] * 4            # step 0 (4 rows + t0 row)
    + [(20, 16, 0, 110, 150)] * 5         # step 1
    + [(30, 20, 2, 700, 900)] * 5         # step 2: p95 900 ms
)


# ---- plan --------------------------------------------------------------------------

def test_plan_steps():
    assert plan_steps(20, 20, 100) == [20, 40, 60, 80, 100]
    assert plan_steps(10, 25, 60) == [10, 35, 60]
    assert plan_steps(50, 10, 50) == [50]


def test_clean_capacity_valid_plan():
    plan, err = clean_capacity({"start_users": 20, "step_users": 20, "step_duration_seconds": 12, "max_users": 200})
    assert err is None
    assert plan["steps"] == [20, 40, 60, 80, 100, 120, 140, 160, 180, 200]
    assert plan["total_seconds"] == 120 and plan["early_stop"] is True


@pytest.mark.parametrize("raw, words", [
    ({"start_users": 0, "step_users": 10, "step_duration_seconds": 10, "max_users": 50}, "start_users"),
    ({"start_users": 10, "step_users": 10, "step_duration_seconds": 10, "max_users": 1001}, "max_users"),
    ({"start_users": 10, "step_users": 10, "step_duration_seconds": 4, "max_users": 50}, "step_duration"),
    ({"start_users": 60, "step_users": 10, "step_duration_seconds": 10, "max_users": 50}, "at least"),
    ({"start_users": 10, "step_users": 10, "step_duration_seconds": 30, "max_users": 200}, "at most 300"),
    ({"start_users": "10", "step_users": 10, "step_duration_seconds": 10, "max_users": 50}, "whole number"),
    ({"start_users": 10, "step_users": 10, "step_duration_seconds": 10, "max_users": 50, "early_stop": "y"}, "early_stop"),
    ("plan", "object"),
])
def test_clean_capacity_rejects(raw, words):
    plan, err = clean_capacity(raw)
    assert plan is None and words in err


def test_ramp_problem():
    from analysis.capacity import ramp_problem
    plan, _ = clean_capacity({"start_users": 20, "step_users": 20, "step_duration_seconds": 12, "max_users": 200})
    assert ramp_problem(plan, 20) is None           # 1 s to add 20 users
    assert ramp_problem(plan, 4) is None            # 5 s: still under half of 12 s
    message = ramp_problem(plan, 1)                 # 20 s: longer than the step
    assert "at least 4" in message


def test_step_slo_leaves_out_throughput():
    assert step_slo({"p95_ms": 500, "min_rps": 50}) == {"p95_ms": 500}
    assert step_slo({"min_rps": 50}) is None
    assert step_slo(None) is None


# ---- per-step metrics from history -----------------------------------------------------

def test_step_metrics_from_history():
    steps = step_metrics(CLIMB, PLAN)
    assert [s["planned_users"] for s in steps] == [10, 20, 30]
    assert [s["requests"] for s in steps] == [32, 80, 100]
    assert [s["p95_ms"] for s in steps] == [120, 150, 900]
    assert steps[0]["avg_ms"] == 100 and steps[1]["avg_ms"] == 110 and steps[2]["avg_ms"] == 700
    assert steps[2]["failure_rate_pct"] == 10.0
    assert all(s["complete"] for s in steps)
    assert steps[1]["rps"] == 16.0


def test_capacity_result_finds_sustainable_and_breaking_point():
    result = capacity_result(CLIMB, PLAN, {"p95_ms": 500})
    assert result["max_sustainable_users"] == 20
    assert result["breaking_point_users"] == 30
    assert "p95 response time 900 ms > 500 ms" in result["breaking_reason"]
    assert result["headline"] == "Max sustainable: 20 users at p95 < 500 ms"
    assert [s["verdict"] for s in result["steps"]] == ["PASS", "PASS", "FAIL"]
    assert result["stopped_early"] is False


def test_no_breaking_point():
    result = capacity_result(CLIMB, PLAN, {"p95_ms": 1000})
    assert result["breaking_point_users"] is None and result["max_sustainable_users"] == 30
    assert result["headline"].startswith("No breaking point within 30 users")


def test_breaks_at_the_first_step():
    result = capacity_result(CLIMB, PLAN, {"p95_ms": 50})
    assert result["max_sustainable_users"] is None and result["breaking_point_users"] == 10
    assert "first step" in result["headline"]


def test_partial_last_step_is_ignored_and_marks_an_early_stop():
    stopped = history([(10, 8, 0, 100, 120)] * 4 + [(20, 16, 0, 600, 800)] * 5 + [(30, 20, 0, 100, 100)] * 1)
    result = capacity_result(stopped, PLAN, {"p95_ms": 500})
    assert [s["complete"] for s in result["steps"]] == [True, True, False]
    assert result["breaking_point_users"] == 20 and result["max_sustainable_users"] == 10
    assert result["stopped_early"] is True and result["tested_up_to_users"] == 20


def test_step_records_supply_failure_categories():
    records = [
        {"step": 0, "requests": 30, "server_error": 0, "connection": 0, "accepted_invalid_input": 0,
         "rejected_valid_input": 0, "rate_limited": 0},
        {"step": 1, "requests": 80, "server_error": 4, "connection": 1, "accepted_invalid_input": 0,
         "rejected_valid_input": 0, "rate_limited": 10},
    ]
    result = capacity_result(CLIMB, PLAN, {"max_server_error_rate_pct": 1}, records)
    step1 = result["steps"][1]
    assert step1["server_error_rate_pct"] == 6.25 and step1["rate_limited_pct"] == 12.5
    assert result["breaking_point_users"] == 20 and result["max_sustainable_users"] == 10
    # Without a record a category rate is unknown, so that step is not judged.
    assert result["steps"][2]["verdict"] is None


def test_no_slo_no_judgement():
    result = capacity_result(CLIMB, PLAN, {"min_rps": 5})
    assert result["headline"] == "No SLO to judge the steps against"
    assert result["breaking_point_users"] is None


def test_empty_history():
    assert step_metrics(None, PLAN) == []
    assert capacity_result("", PLAN, {"p95_ms": 500})["headline"] == "No complete step to judge"


# ---- run-time snapshots used by the Locust step shape ---------------------------------------

def test_error_kind_from_locust_messages():
    assert error_kind("CatchResponseError('server_error (500): expected a 4xx rejection, got 500')") == "server_error"
    assert error_kind("CatchResponseError('accepted_invalid_input (200): expected a 4xx rejection, got 200')") \
        == "accepted_invalid_input"
    assert error_kind("HTTPError('429 Client Error: TOO MANY REQUESTS for url: x')") == "rate_limited"
    assert error_kind("ConnectionRefusedError(10061)") == "connection"


def test_step_record_is_the_difference_of_two_snapshots():
    before = snapshot(100, 5, 10_000.0, [("server_error (500): x", 2), ("rate_limited (429): y", 3)])
    after = snapshot(300, 25, 40_000.0, [("server_error (500): x", 10), ("rate_limited (429): y", 13),
                                          ("accepted_invalid_input (200): z", 2)])
    record = step_record(1, 40, before, after, 10, 640)
    assert record == {"step": 1, "users": 40, "seconds": 10, "requests": 200, "failures": 20, "avg_ms": 150.0,
                      "p95_ms": 640, "server_error": 8, "connection": 0, "accepted_invalid_input": 2,
                      "rejected_valid_input": 0, "rate_limited": 10}
    assert record_rates(record) == {"server_error_rate_pct": 4.0, "unexpected_outcome_rate_pct": 1.0,
                                    "rate_limited_pct": 5.0}


# ---- endpoints -----------------------------------------------------------------------------

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(job_store, "DB_PATH", str(tmp_path / "test.db"))
    job_store.init_db()
    started = []
    monkeypatch.setattr(load_test_runner, "_run_api_job", lambda *a, **k: started.append((a, k)))
    monkeypatch.setattr(load_test_runner, "_run_website_job", lambda *a, **k: started.append((a, k)))
    c = app.test_client()
    c.started = started
    return c


CAP = {"start_users": 20, "step_users": 20, "step_duration_seconds": 12, "max_users": 200}
CASES = [{"label": "valid_sample", "payload": {"x": 1}, "expect": "accept"}]


def _start(client, path="/api/start-load-test", **extra):
    body = {"url": "http://127.0.0.1:8000/api/login", "confirmed_cases": CASES, "i_own_target": True,
            "mode": "capacity", "capacity": CAP, "spawn_rate": 20, "slo": {"p95_ms": 500}}
    body.update(extra)
    return client.post(path, json=body)


def test_capacity_run_is_one_job_even_above_the_split_threshold(client):
    resp = _start(client)
    body = resp.get_json()
    assert resp.status_code == 202 and body["mode"] == "capacity" and body["is_group"] is False
    assert job_store.get_job_group(body["job_id"]) is None
    job = job_store.get_job(body["job_id"])
    assert job["users"] == 200 and job["duration_seconds"] == 120
    (args, kwargs), = [s for s in client.started]
    step_plan = kwargs["step_plan"]
    assert step_plan["steps"][0] == 20 and step_plan["spawn_rate"] == 20 and step_plan["early_stop"] is True
    assert step_plan["slo"] == {"p95_ms": 500}


def test_website_capacity_run(client):
    resp = _start(client, path="/api/start-website-load-test", url="http://127.0.0.1:8000/")
    assert resp.status_code == 202
    assert client.started[0][1]["step_plan"]["steps"][-1] == 200


@pytest.mark.parametrize("extra, word", [
    ({"slo": None}, "needs an SLO"),
    ({"slo": {"min_rps": 10}}, "needs an SLO"),
    ({"capacity": {**CAP, "step_duration_seconds": 40}}, "at most 300"),
    ({"repeat": 3}, "repeat"),
    ({"mode": "turbo"}, "mode"),
    ({"spawn_rate": 50}, "spawn_rate"),
    ({"spawn_rate": 2}, "more than half"),
])
def test_capacity_validation(client, extra, word):
    resp = _start(client, **extra)
    assert resp.status_code == 400 and word in resp.get_json()["error"]
    assert client.started == []


def test_capacity_refused_in_sqs_mode(client, monkeypatch):
    monkeypatch.setattr(load_test_runner, "USE_SQS", True)
    assert _start(client).status_code == 409


def test_status_reports_the_capacity_result(client):
    run_id = _start(client, capacity={"start_users": 10, "step_users": 10, "step_duration_seconds": 5,
                                      "max_users": 30}).get_json()["job_id"]
    assert run_id
    job_store.update_job(run_id, status="completed", history_csv=CLIMB, stats_csv="Type,Name\n",
                         capacity_steps=json.dumps([]))
    status = app.test_client().get(f"/api/load-test-status/{run_id}").get_json()
    assert status["mode"] == "capacity" and status["slo_verdict"] is None
    assert status["capacity"]["breaking_point_users"] == 30
    assert status["capacity"]["headline"] == "Max sustainable: 20 users at p95 < 500 ms"
    row = next(r for r in app.test_client().get("/api/jobs").get_json()["jobs"] if r["job_id"] == run_id)
    assert row["mode"] == "capacity"


def test_fixed_runs_are_unchanged(client):
    resp = client.post("/api/start-load-test", json={
        "url": "http://127.0.0.1:8000/api/login", "confirmed_cases": CASES, "i_own_target": True, "users": 5})
    assert resp.status_code == 202 and "mode" not in resp.get_json()
    status = client.get(f"/api/load-test-status/{resp.get_json()['job_id']}").get_json()
    assert status["mode"] == "fixed" and status["capacity"] is None


# ---- runner wiring -------------------------------------------------------------------------

def test_locustfiles_add_the_shape_only_for_capacity_runs(tmp_path):
    env = {}
    plain = load_test_runner._locustfiles("dynamic_locustfile.py", env, str(tmp_path), None)
    assert "," not in plain and "LOCUST_STEP_PLAN" not in env
    both = load_test_runner._locustfiles("dynamic_locustfile.py", env, str(tmp_path), {"steps": [1]})
    user_file, shape_file = both.split(",")
    assert user_file.endswith("dynamic_locustfile.py") and shape_file.endswith("step_shape.py")
    assert os.path.exists(user_file) and os.path.exists(shape_file)
    assert json.loads(env["LOCUST_STEP_PLAN"])["steps_file"] == os.path.join(str(tmp_path), "steps.json")


def test_step_records_are_stored_before_the_run_is_completed(tmp_path, monkeypatch):
    monkeypatch.setattr(job_store, "DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setattr(load_test_runner, "RESULTS_DIR", str(tmp_path / "results"))
    job_store.init_db()
    seen = {}

    class FakeProc:
        returncode = 0

        def __init__(self, cmd, env=None, **kwargs):
            seen["cmd"] = cmd
            self.cmd = cmd
            plan = json.loads(env["LOCUST_STEP_PLAN"])
            with open(plan["steps_file"], "w") as f:
                json.dump([{"step": 0, "requests": 3}], f)

        def communicate(self, timeout=None):
            prefix = self.cmd[self.cmd.index("--csv") + 1]
            with open(prefix + "_stats.csv", "w") as f:
                f.write("Type,Name,Request Count,Failure Count\n,Aggregated,3,0\n")
            return "", ""

        def terminate(self):
            pass

    monkeypatch.setattr(subprocess, "Popen", FakeProc)
    job_store.create_job("cap", "http://t", 30, 10, 20)
    load_test_runner._run_api_job("cap", "http://t", "/x", CASES, 30, 10, 20, None, step_plan={"steps": [10, 20]})
    job = job_store.get_job("cap")
    assert job["status"] == "completed"
    assert json.loads(job["capacity_steps"]) == [{"step": 0, "requests": 3}]
    assert "step_shape.py" in seen["cmd"][seen["cmd"].index("-f") + 1]
