"""Stopping runs: no real Locust process is started; subprocess.Popen is
replaced by a fake whose communicate() blocks until terminate() is called."""
import os
import subprocess
import threading

import pytest

import job_store
import load_test_runner
from app import app

STATS = "Type,Name,Request Count,Failure Count,95%\nPOST,a,10,0,100\n,Aggregated,10,0,100\n"


class FakeProc:
    def __init__(self, *args, **kwargs):
        self.env = kwargs.get("env")
        self.stopped = threading.Event()
        self.terminated = False

    def communicate(self, timeout=None):
        self.stopped.wait(5)
        return "out", "err"

    def terminate(self):
        self.terminated = True
        self.stopped.set()

    def kill(self):
        self.stopped.set()


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(job_store, "DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setattr(load_test_runner, "_cancel_requested", set())
    monkeypatch.setattr(load_test_runner, "_processes", {})
    job_store.init_db()
    return tmp_path


def _run_in_thread(job_id, csv_prefix):
    t = threading.Thread(
        target=load_test_runner._run_locust,
        args=(job_id, __file__, {}, "http://t", 1, 1, 30, csv_prefix),
    )
    t.start()
    return t


def _wait_for_process(job_id):
    for _ in range(200):
        if job_id in load_test_runner._processes:
            return load_test_runner._processes[job_id]
        threading.Event().wait(0.01)
    raise AssertionError("process never registered")


def test_cancel_running_job_keeps_partial_csv(db, monkeypatch):
    monkeypatch.setattr(subprocess, "Popen", FakeProc)
    job_store.create_job("j1", "http://t", 1, 1, 30)
    prefix = str(db / "result")
    with open(prefix + "_stats.csv", "w") as f:
        f.write(STATS)

    t = _run_in_thread("j1", prefix)
    proc = _wait_for_process("j1")
    assert load_test_runner.cancel_run("j1") is True
    t.join(5)

    assert proc.terminated
    job = job_store.get_job("j1")
    assert job["status"] == "cancelled"
    assert job["stats_csv"] == STATS
    assert job["completed_at"] is not None


def test_cancel_running_job_without_csv_has_no_results(db, monkeypatch):
    monkeypatch.setattr(subprocess, "Popen", FakeProc)
    job_store.create_job("j1", "http://t", 1, 1, 30)
    t = _run_in_thread("j1", str(db / "nothing"))
    _wait_for_process("j1")
    load_test_runner.cancel_run("j1")
    t.join(5)
    job = job_store.get_job("j1")
    assert job["status"] == "cancelled"
    assert job["stats_csv"] is None


def test_uncancelled_job_still_completes(db, monkeypatch):
    class Quick(FakeProc):
        def communicate(self, timeout=None):
            return "out", "err"

    monkeypatch.setattr(subprocess, "Popen", Quick)
    job_store.create_job("j1", "http://t", 1, 1, 30)
    load_test_runner._run_locust("j1", __file__, {}, "http://t", 1, 1, 30, str(db / "r"))
    assert job_store.get_job("j1")["status"] == "completed"
    assert load_test_runner._processes == {}


def test_timeout_still_reported_as_timeout(db, monkeypatch):
    class Slow(FakeProc):
        calls = 0

        def communicate(self, timeout=None):
            Slow.calls += 1
            if Slow.calls == 1:
                raise subprocess.TimeoutExpired("locust", timeout)
            return "", ""

    monkeypatch.setattr(subprocess, "Popen", Slow)
    job_store.create_job("j1", "http://t", 1, 1, 30)
    load_test_runner._run_locust("j1", __file__, {}, "http://t", 1, 1, 30, str(db / "r"))
    assert job_store.get_job("j1")["status"] == "timeout"


def test_cancel_queued_job_never_starts_locust(db, monkeypatch):
    started = []
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: started.append(1))
    job_store.create_job("j1", "http://t", 1, 1, 30)
    load_test_runner.cancel_run("j1")
    assert job_store.get_job("j1")["status"] == "cancelled"
    load_test_runner._run_locust("j1", __file__, {}, "http://t", 1, 1, 30, str(db / "r"))
    assert started == []


def test_cancel_group_stops_every_child_and_merges_partials(db):
    job_store.create_job_group("g", "http://t", "api", 100, 1, 30, 2)
    for child in ("c1", "c2"):
        job_store.create_job(child, "http://t", 50, 1, 30, group_id="g")
    job_store.update_job("c1", status="running")
    procs = {cid: FakeProc() for cid in ("c1", "c2")}
    load_test_runner._processes.update(procs)

    load_test_runner.cancel_run("g")
    assert procs["c1"].terminated and procs["c2"].terminated
    # A queued child with a registered process is terminated, not marked
    # directly; simulate the runner recording both results.
    job_store.update_job("c1", status="cancelled", stats_csv=STATS)
    job_store.update_job("c2", status="cancelled")

    group = load_test_runner.get_group_status("g")
    assert group["status"] == "cancelled"
    assert "Aggregated,10" in group["aggregated_stats_csv"]


def test_group_is_cancelled_only_once_every_child_has_stopped(db):
    job_store.create_job_group("g", "http://t", "api", 100, 1, 30, 2)
    job_store.create_job("c1", "http://t", 50, 1, 30, group_id="g")
    job_store.create_job("c2", "http://t", 50, 1, 30, group_id="g")
    job_store.update_job("c1", status="cancelled")
    job_store.update_job("c2", status="running")
    assert load_test_runner.get_group_status("g")["status"] == "running"
    job_store.update_job("c2", status="completed", stats_csv=STATS)
    assert load_test_runner.get_group_status("g")["status"] == "cancelled"


def test_cancel_endpoint(db, monkeypatch):
    client = app.test_client()
    job_store.create_job("j1", "http://t", 1, 1, 30)
    assert client.post("/api/cancel/nope").status_code == 404
    resp = client.post("/api/cancel/j1")
    assert resp.status_code == 202
    assert client.get("/api/load-test-status/j1").get_json()["status"] == "cancelled"


def test_cancel_endpoint_refuses_in_sqs_mode(db, monkeypatch):
    monkeypatch.setattr(load_test_runner, "USE_SQS", True)
    job_store.create_job("j1", "http://t", 1, 1, 30)
    resp = app.test_client().post("/api/cancel/j1")
    assert resp.status_code == 409
    assert "SQS" in resp.get_json()["error"]
    assert job_store.get_job("j1")["status"] == "queued"


def test_finished_job_is_not_changed_by_cancel(db):
    job_store.create_job("j1", "http://t", 1, 1, 30)
    job_store.update_job("j1", status="completed")
    load_test_runner.cancel_run("j1")
    assert job_store.get_job("j1")["status"] == "completed"
