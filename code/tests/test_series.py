"""Repeat series: the runner loop and the endpoints, with fake runs (no
Locust, no threads, no waiting)."""
import pytest

import job_store
import load_test_runner
from app import app

STATS = ("Type,Name,Request Count,Failure Count,Requests/s,95%\n"
         "POST,a,10,{f},1,100\n,Aggregated,10,{f},{rps},{p95}\n")


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(job_store, "DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setattr(load_test_runner, "_cancel_requested", set())
    monkeypatch.setattr(load_test_runner, "_processes", {})
    job_store.init_db()


def fake_starter(outcomes):
    """start_one() that creates a job already in the next outcome status."""
    counter = {"n": 0}

    def start_one():
        counter["n"] += 1
        job_id = f"run{counter['n']}"
        status = outcomes[counter["n"] - 1]
        job_store.create_job(job_id, "http://t", 10, 1, 5)
        job_store.update_job(job_id, status=status,
                             stats_csv=STATS.format(f=counter["n"], rps=10 + counter["n"], p95=100 * counter["n"]))
        return job_id, False

    return start_one, counter


def _series(repeat):
    job_store.create_series("s1", "http://t", "api", 10, 1, 5, repeat)


def test_all_repeats_complete(db):
    _series(3)
    start_one, counter = fake_starter(["completed"] * 3)
    load_test_runner._run_series("s1", 3, start_one, sleep=lambda s: None)
    series = job_store.get_series("s1")
    assert series["status"] == "completed"
    assert series["run_ids"] == ["run1", "run2", "run3"]
    assert counter["n"] == 3


def test_a_failed_repeat_ends_the_series(db):
    _series(3)
    start_one, counter = fake_starter(["completed", "failed", "completed"])
    load_test_runner._run_series("s1", 3, start_one, sleep=lambda s: None)
    series = job_store.get_series("s1")
    assert series["status"] == "failed"
    assert "repeat 2 of 3" in series["error"]
    assert counter["n"] == 2


def test_waits_for_each_repeat_to_finish(db):
    _series(1)
    polls = []

    def start_one():
        job_store.create_job("run1", "http://t", 10, 1, 5)
        job_store.update_job("run1", status="running")
        return "run1", False

    def sleep(seconds):
        polls.append(seconds)
        if len(polls) == 2:
            job_store.update_job("run1", status="completed")

    load_test_runner._run_series("s1", 1, start_one, sleep=sleep)
    assert len(polls) == 2
    assert job_store.get_series("s1")["status"] == "completed"


def test_cancel_stops_the_current_repeat_and_starts_no_more(db):
    _series(3)
    started = []

    def start_one():
        job_id = f"run{len(started) + 1}"
        started.append(job_id)
        job_store.create_job(job_id, "http://t", 10, 1, 5)
        job_store.update_job(job_id, status="running")
        return job_id, False

    def sleep(seconds):
        # The user presses Stop while the first repeat is running.
        load_test_runner.cancel_run("s1")
        # The runner would record the terminated job as cancelled.
        job_store.update_job(started[-1], status="cancelled")

    load_test_runner._run_series("s1", 3, start_one, sleep=sleep)
    assert started == ["run1"]
    assert job_store.get_series("s1")["status"] == "cancelled"
    assert "run1" in load_test_runner._cancel_requested


def test_status_endpoint_reports_series_and_summary(db):
    _series(2)
    start_one, _ = fake_starter(["completed", "completed"])
    load_test_runner._run_series("s1", 2, start_one, sleep=lambda s: None)

    body = app.test_client().get("/api/load-test-status/s1").get_json()
    assert body["series_id"] == "s1" and body["status"] == "completed"
    assert [r["id"] for r in body["runs"]] == ["run1", "run2"]
    summary = body["series_summary"]
    assert summary["repeats"] == 2
    assert summary["overall"]["throughput"]["values"] == [11.0, 12.0]
    assert summary["cases"][0]["case"] == "a"
    # Each repeat is still an ordinary run of its own.
    assert app.test_client().get("/api/load-test-status/run1").get_json()["status"] == "completed"


def test_no_summary_while_running(db):
    _series(2)
    job_store.update_series("s1", status="running")
    body = app.test_client().get("/api/load-test-status/s1").get_json()
    assert body["status"] == "running" and body["series_summary"] is None


def test_cancel_endpoint_accepts_a_series(db):
    _series(2)
    job_store.update_series("s1", status="running")
    assert app.test_client().post("/api/cancel/s1").status_code == 202
    assert "s1" in load_test_runner._cancel_requested


# ---- start endpoints ---------------------------------------------------------

CASES = [{"label": "a", "payload": {"x": 1}}]


@pytest.fixture
def client(db, monkeypatch):
    dispatched = []
    monkeypatch.setattr(load_test_runner, "_dispatch_single", lambda *a, **k: dispatched.append(a))
    started = {}

    def fake_start_series(job_type, host, users, spawn_rate, duration, repeat, start_one, header_names=None):
        started.update(job_type=job_type, repeat=repeat, users=users)
        started["first_run"] = start_one()  # what each repeat would start
        return "series-1"

    monkeypatch.setattr(load_test_runner, "start_series", fake_start_series)
    c = app.test_client()
    c.started, c.dispatched = started, dispatched
    return c


def _start(client, **extra):
    body = {"url": "http://127.0.0.1:8000/api/login", "confirmed_cases": CASES,
            "users": 10, "spawn_rate": 1, "duration_seconds": 5}
    body.update(extra)
    return client.post("/api/start-load-test", json=body)


def test_repeat_1_is_the_old_behaviour(client):
    resp = _start(client)
    assert resp.status_code == 202
    assert set(resp.get_json()) == {"job_id", "status", "is_group"}
    assert client.started == {}
    resp = _start(client, repeat=1)
    assert "is_series" not in resp.get_json()


def test_repeat_3_starts_a_series(client):
    body = _start(client, repeat=3).get_json()
    assert body["job_id"] == body["series_id"] == "series-1"
    assert body["is_series"] is True and body["repeat"] == 3
    assert client.started["repeat"] == 3 and client.started["job_type"] == "api"
    assert client.started["first_run"][1] is False  # an ordinary single run


def test_series_of_split_runs(client):
    body = _start(client, repeat=2, users=120).get_json()
    assert body["is_group"] is True
    run_id, is_group = client.started["first_run"]
    assert is_group is True and len(job_store.list_child_jobs(run_id)) == 3


@pytest.mark.parametrize("repeat", [0, 6, "x"])
def test_bad_repeat_is_rejected(client, repeat):
    assert _start(client, repeat=repeat).status_code == 400
    assert client.dispatched == []


def test_website_series(client):
    resp = client.post("/api/start-website-load-test", json={
        "url": "http://127.0.0.1:8000/", "users": 2, "spawn_rate": 1, "duration_seconds": 5, "repeat": 2,
    })
    body = resp.get_json()
    assert resp.status_code == 202 and body["is_series"] is True and body["paths_used"] == ["/"]
    assert client.started["job_type"] == "website"
