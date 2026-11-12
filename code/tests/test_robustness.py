"""Robustness fixes: the server-side active-run limit, Locust's exit status,
interrupted runs after a restart, group status persistence, and the
read-only reachability probe."""
import json
import os
import sqlite3
import subprocess
import sys

import pytest

import job_store
import load_test_runner
from analysis import sanity_check as sanity_module
from analysis.type_detector import detect_type
from app import app

CODE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASES = [{"label": "valid_sample", "payload": {"x": 1}, "expect": "accept"}]
STATS = "Type,Name,Request Count,Failure Count\nPOST,a,10,0\n,Aggregated,10,0\n"


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(job_store, "DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setattr(load_test_runner, "_cancel_requested", set())
    monkeypatch.setattr(load_test_runner, "_processes", {})
    job_store.init_db()
    return tmp_path


@pytest.fixture
def client(db, monkeypatch):
    """Starts runs without Locust: dispatch and capacity runs do nothing, so
    started runs stay "queued" (active) until a test finishes them."""
    monkeypatch.setenv("MAX_ACTIVE_RUNS", "1")
    monkeypatch.setattr(load_test_runner, "_dispatch_single", lambda *a, **k: None)
    monkeypatch.setattr(load_test_runner, "_run_api_job", lambda *a, **k: None)
    monkeypatch.setattr(load_test_runner, "_run_website_job", lambda *a, **k: None)
    monkeypatch.setattr(load_test_runner.threading, "Thread", _NoThread)
    return app.test_client()


class _NoThread:
    """Stands in for the series thread so a series stays "queued"."""

    def __init__(self, *args, **kwargs):
        pass

    def start(self):
        pass


def _start(client, path="/api/start-load-test", **extra):
    body = {"url": "http://127.0.0.1:8000/api/login", "confirmed_cases": CASES, "users": 5,
            "spawn_rate": 5, "duration_seconds": 5, "i_own_target": True}
    body.update(extra)
    return client.post(path, json=body)


def _finish_all():
    with sqlite3.connect(job_store.DB_PATH) as conn:
        for table in ("jobs", "job_groups", "series"):
            conn.execute(f"UPDATE {table} SET status = 'completed'")


# ---- 1. at most MAX_ACTIVE_RUNS load tests --------------------------------------------

def test_second_run_is_refused_with_429(client):
    assert _start(client).status_code == 202
    resp = _start(client)
    body = resp.get_json()
    assert resp.status_code == 429
    assert body["busy"] is True and body["active_runs"] == 1 and body["max_active_runs"] == 1
    assert "already running" in body["error"] and "at most 1 at a time" in body["error"]
    assert _start(client, path="/api/start-website-load-test", url="http://127.0.0.1:8000/").status_code == 429


def test_a_finished_run_frees_the_slot(client):
    assert _start(client).status_code == 202
    _finish_all()
    assert _start(client).status_code == 202


def test_a_split_group_counts_as_one_run(client, monkeypatch):
    monkeypatch.setenv("MAX_ACTIVE_RUNS", "2")
    run_id = _start(client, users=150).get_json()["job_id"]
    assert len(job_store.list_child_jobs(run_id)) == 3
    assert load_test_runner.active_run_count() == 1
    assert _start(client).status_code == 202          # 2 of 2
    assert _start(client).status_code == 429


def test_a_series_counts_as_one_run_with_its_repeat(client, db):
    resp = _start(client, repeat=3)
    assert resp.status_code == 202
    series_id = resp.get_json()["series_id"]
    # The series thread would start its first repeat: simulate one running.
    job_store.create_job("repeat-1", "http://127.0.0.1:8000", 5, 5, 5)
    job_store.update_job("repeat-1", status="running")
    job_store.update_series(series_id, status="running", run_ids=json.dumps(["repeat-1"]))
    assert load_test_runner.active_run_count() == 1
    assert _start(client).status_code == 429


def test_a_capacity_run_counts_as_one_run(client):
    resp = _start(client, mode="capacity", slo={"p95_ms": 500}, spawn_rate=20,
                  capacity={"start_users": 20, "step_users": 20, "step_duration_seconds": 12, "max_users": 200})
    assert resp.status_code == 202
    assert load_test_runner.active_run_count() == 1
    assert _start(client).status_code == 429


def test_a_group_whose_children_finished_is_not_counted(client):
    run_id = _start(client, users=150).get_json()["job_id"]
    for child in job_store.list_child_jobs(run_id):
        job_store.update_job(child["job_id"], status="completed", stats_csv=STATS)
    assert job_store.get_job_group(run_id)["status"] == "queued"   # stale row
    assert load_test_runner.active_run_count() == 0
    assert _start(client).status_code == 202


@pytest.mark.parametrize("value, limit", [("3", 3), ("0", 1), ("abc", 1)])
def test_max_active_runs_setting(monkeypatch, value, limit):
    from app import _max_active_runs
    monkeypatch.setenv("MAX_ACTIVE_RUNS", value)
    assert _max_active_runs() == limit


# ---- 2. Locust's exit status ---------------------------------------------------------------

def _fake_popen(returncode, stderr="", write_stats=True):
    class FakeProc:
        def __init__(self, cmd, env=None, **kwargs):
            self.cmd = cmd
            self.returncode = returncode
            FakeProc.cmd_seen = cmd

        def communicate(self, timeout=None):
            if write_stats:
                with open(self.cmd[self.cmd.index("--csv") + 1] + "_stats.csv", "w") as f:
                    f.write(STATS)
            return "", stderr

        def terminate(self):
            pass

    return FakeProc


TRACEBACK = ("[INFO] Starting Locust\nTraceback (most recent call last):\n  File \"x.py\", line 1\n"
             "ImportError: cannot import name 'thing'\nType     Name    # reqs\n-------- table --------\n")


def test_non_zero_exit_marks_the_job_failed_with_the_traceback(db, monkeypatch):
    monkeypatch.setattr(subprocess, "Popen", _fake_popen(2, stderr=TRACEBACK))
    job_store.create_job("j", "http://t", 1, 1, 5)
    load_test_runner._run_locust("j", __file__, {}, "http://t", 1, 1, 5, str(db / "r"))
    job = job_store.get_job("j")
    assert job["status"] == "failed"
    assert job["error"].startswith("Locust exited with code 2.")
    assert "ImportError: cannot import name 'thing'" in job["error"]
    assert "-------- table" not in job["error"]          # the stats table after the traceback is cut
    assert job["stats_csv"] == STATS                     # whatever was written is kept


def test_missing_statistics_marks_the_job_failed(db, monkeypatch):
    monkeypatch.setattr(subprocess, "Popen", _fake_popen(0, stderr="line 1\nline 2\n", write_stats=False))
    job_store.create_job("j", "http://t", 1, 1, 5)
    load_test_runner._run_locust("j", __file__, {}, "http://t", 1, 1, 5, str(db / "r"))
    job = job_store.get_job("j")
    assert job["status"] == "failed" and job["stats_csv"] is None
    assert "without writing statistics" in job["error"] and "line 2" in job["error"]


def test_clean_exit_with_statistics_completes_and_failures_do_not_change_the_exit_code(db, monkeypatch):
    fake = _fake_popen(0)
    monkeypatch.setattr(subprocess, "Popen", fake)
    job_store.create_job("j", "http://t", 1, 1, 5)
    load_test_runner._run_locust("j", __file__, {}, "http://t", 1, 1, 5, str(db / "r"))
    assert job_store.get_job("j")["status"] == "completed"
    cmd = fake.cmd_seen
    assert cmd[cmd.index("--exit-code-on-error") + 1] == "0"


def test_a_stopped_run_is_cancelled_whatever_the_exit_code(db, monkeypatch):
    base = _fake_popen(1)

    class StoppedDuringRun(base):
        def communicate(self, timeout=None):
            load_test_runner._cancel_requested.add("j")   # Stop pressed while running
            return super().communicate(timeout)

    monkeypatch.setattr(subprocess, "Popen", StoppedDuringRun)
    job_store.create_job("j", "http://t", 1, 1, 5)
    load_test_runner._run_locust("j", __file__, {}, "http://t", 1, 1, 5, str(db / "r"))
    job = job_store.get_job("j")
    assert job["status"] == "cancelled" and job["error"] is None


def test_a_failed_child_fails_its_group_and_the_group_row_is_updated(db, monkeypatch):
    monkeypatch.setattr(subprocess, "Popen", _fake_popen(1, stderr="boom"))
    job_store.create_job_group("g", "http://t", "api", 100, 1, 5, 2)
    job_store.create_job("c1", "http://t", 50, 1, 5, group_id="g")
    job_store.create_job("c2", "http://t", 50, 1, 5, group_id="g")
    load_test_runner._run_locust("c1", __file__, {}, "http://t", 50, 1, 5, str(db / "r"))
    assert job_store.get_job_group("g")["status"] == "failed"
    status = app.test_client().get("/api/load-test-status/g").get_json()
    assert status["status"] == "failed"


def test_status_of_a_failed_run_without_statistics_has_no_crashing_fields(db):
    job_store.create_job("j", "http://t", 1, 1, 5)
    job_store.update_job("j", status="failed", error="Locust exited with code 2. boom")
    body = app.test_client().get("/api/load-test-status/j").get_json()
    assert body["status"] == "failed" and body["stats_csv"] is None
    assert body["failure_summary"] == [] and body["problem_rate"] is None and body["slo_verdict"] is None


# ---- 3. runs left behind by a previous process -------------------------------------------------

def test_mark_interrupted_runs(db):
    job_store.create_job("queued-job", "http://t", 1, 1, 5)
    job_store.create_job("running-job", "http://t", 1, 1, 5)
    job_store.update_job("running-job", status="running")
    job_store.create_job("done-job", "http://t", 1, 1, 5)
    job_store.update_job("done-job", status="completed")
    job_store.create_job_group("g", "http://t", "api", 100, 1, 5, 1)
    job_store.create_job("child", "http://t", 100, 1, 5, group_id="g")
    job_store.create_series("s", "http://t", "api", 1, 1, 5, 2)

    counts = job_store.mark_interrupted_runs()
    assert counts == {"jobs": 3, "job_groups": 1, "series": 1}
    assert job_store.get_job("running-job")["status"] == "interrupted"
    assert job_store.get_job("running-job")["completed_at"] is not None
    assert "backend stopped" in job_store.get_job("queued-job")["error"]
    assert job_store.get_job("done-job")["status"] == "completed"
    assert load_test_runner.get_group_status("g")["status"] == "interrupted"
    assert job_store.get_series("s")["status"] == "interrupted"
    assert load_test_runner.active_run_count() == 0
    listing = app.test_client().get("/api/jobs").get_json()
    assert {r["job_id"]: r["status"] for r in listing["jobs"]}["running-job"] == "interrupted"


def test_backend_startup_marks_stale_runs_interrupted(tmp_path):
    database = tmp_path / "startup.db"
    job_store_env = {**os.environ, "DB_PATH": str(database), "RECOVER_STALE_RUNS": "true", "USE_SQS": "false"}
    setup = ("import job_store; job_store.init_db(); job_store.create_job('left', 'http://t', 1, 1, 5); "
             "job_store.update_job('left', status='running')")
    subprocess.run([sys.executable, "-c", setup], cwd=CODE_DIR, env=job_store_env, check=True)
    # Importing app is what gunicorn and `python app.py` do at startup.
    subprocess.run([sys.executable, "-c", "import app"], cwd=CODE_DIR, env=job_store_env, check=True,
                   capture_output=True)
    with sqlite3.connect(database) as conn:
        assert conn.execute("SELECT status FROM jobs WHERE job_id = 'left'").fetchone()[0] == "interrupted"


def test_startup_sweep_can_be_switched_off(tmp_path):
    database = tmp_path / "startup.db"
    env = {**os.environ, "DB_PATH": str(database), "RECOVER_STALE_RUNS": "false"}
    setup = ("import job_store; job_store.init_db(); job_store.create_job('left', 'http://t', 1, 1, 5); "
             "job_store.update_job('left', status='running')")
    subprocess.run([sys.executable, "-c", setup], cwd=CODE_DIR, env=env, check=True)
    subprocess.run([sys.executable, "-c", "import app"], cwd=CODE_DIR, env=env, check=True, capture_output=True)
    with sqlite3.connect(database) as conn:
        assert conn.execute("SELECT status FROM jobs WHERE job_id = 'left'").fetchone()[0] == "running"


# ---- 4. group status is persisted -----------------------------------------------------------------

def test_group_row_follows_its_children(db):
    job_store.create_job_group("g", "http://t", "api", 100, 1, 5, 2)
    job_store.create_job("c1", "http://t", 50, 1, 5, group_id="g")
    job_store.create_job("c2", "http://t", 50, 1, 5, group_id="g")
    load_test_runner._set_job("c1", status="running")
    assert job_store.get_job_group("g")["status"] == "running"
    load_test_runner._set_job("c1", status="completed", stats_csv=STATS)
    load_test_runner._set_job("c2", status="completed", stats_csv=STATS)
    assert job_store.get_job_group("g")["status"] == "completed"


def test_jobs_list_refreshes_a_stale_group(db):
    job_store.create_job_group("g", "http://t", "api", 100, 1, 5, 1)
    job_store.create_job("c1", "http://t", 100, 1, 5, group_id="g")
    job_store.update_job("c1", status="completed", stats_csv=STATS)   # bypasses _set_job
    assert job_store.get_job_group("g")["status"] == "queued"
    listing = app.test_client().get("/api/jobs").get_json()
    assert listing["job_groups"][0]["status"] == "completed"
    assert job_store.get_job_group("g")["status"] == "completed"       # persisted


# ---- 5. the reachability probe never POSTs ----------------------------------------------------------

class Resp:
    def __init__(self, status, headers=None, url="http://t/api/login"):
        self.status_code, self.url = status, url
        self.headers = headers or {}


def _probe(monkeypatch, answers):
    seen = []

    def fake_request(method, url, **kwargs):
        seen.append(method)
        answer = answers[method]
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(sanity_module.requests, "request", fake_request)
    monkeypatch.setattr(sanity_module.requests, "post",
                        lambda *a, **k: pytest.fail("the probe must never POST"))
    return sanity_module.check_reachability("http://t/api/login", guard=lambda url: None), seen


def test_post_only_endpoint_is_reachable_method_not_allowed(monkeypatch):
    answers = {
        "HEAD": Resp(405, {"Allow": "OPTIONS, POST", "Content-Type": "text/html"}),
        "GET": Resp(405, {"Allow": "OPTIONS, POST", "Content-Type": "text/html"}),
        "OPTIONS": Resp(200, {"Allow": "OPTIONS, POST", "Content-Type": "text/html"}),
    }
    result, seen = _probe(monkeypatch, answers)
    assert seen == ["HEAD", "GET", "OPTIONS"]
    assert result["reachable"] is True and result["method_not_allowed"] is True
    assert result["status_code"] == 405 and result["allowed_methods"] == "OPTIONS, POST"
    detection = detect_type("http://t/api/login", result["headers"], result["attempts"])
    assert detection["classification"] == "api"
    assert ("write_only_methods", "api", 0.8) in [tuple(s) for s in detection["signals"]]


def test_a_page_answers_get_and_stops_the_probe(monkeypatch):
    answers = {"HEAD": Resp(200, {"Content-Type": "text/html; charset=utf-8"}), "GET": None, "OPTIONS": None}
    result, seen = _probe(monkeypatch, answers)
    assert seen == ["HEAD"] and result["status_code"] == 200 and "method_not_allowed" not in result
    assert detect_type("http://t/", result["headers"], result["attempts"])["classification"] == "website"


def test_json_error_from_get_means_api(monkeypatch):
    answers = {
        "HEAD": Resp(404, {}),
        "GET": Resp(404, {"Content-Type": "application/json"}),
        "OPTIONS": Resp(204, {"Access-Control-Allow-Methods": "GET,HEAD,PUT,PATCH,POST,DELETE"}),
    }
    result, _ = _probe(monkeypatch, answers)
    assert result["method_not_allowed"] is True and result["status_code"] == 404
    assert detect_type("http://t/auth/login", result["headers"], result["attempts"])["classification"] == "api"


def test_html_error_pages_do_not_make_an_endpoint_a_website(monkeypatch):
    answers = {
        "HEAD": Resp(405, {"Content-Type": "text/html"}),
        "GET": Resp(405, {"Content-Type": "text/html"}),
        "OPTIONS": Resp(200, {"Content-Type": "text/html"}),
    }
    result, _ = _probe(monkeypatch, answers)
    detection = detect_type("http://t/login", result["headers"], result["attempts"])
    assert detection["classification"] == "api"   # GET refused with 405, no page served


def test_unreachable_server(monkeypatch):
    error = sanity_module.requests.exceptions.ConnectionError("refused")
    result, seen = _probe(monkeypatch, {"HEAD": error, "GET": error, "OPTIONS": error})
    assert seen == ["HEAD", "GET", "OPTIONS"]
    assert result["reachable"] is False and "refused" in result["error"]
