"""Request headers: validation, and proof that header VALUES are never
persisted (database, files, API responses) — only their names."""
import os
import sqlite3
import subprocess

import pytest

import job_store
import load_test_runner
from analysis import sanity_check as sanity_module
from analysis.request_headers import clean_headers, header_names, redact
from app import app

SECRET = "Bearer s3cr3t-T0KEN-value"
HEADERS = {"Authorization": SECRET, "X-Team": "elevate-team-id-42"}
CASES = [{"label": "a", "payload": {"x": 1}}]


# ---- pure functions --------------------------------------------------------

def test_clean_headers_accepts_name_value_pairs_and_trims_values():
    headers, err = clean_headers({"Authorization": "  Bearer abc  ", "X-Api-Key": "k"})
    assert err is None
    assert headers == {"Authorization": "Bearer abc", "X-Api-Key": "k"}


def test_clean_headers_none_or_empty():
    assert clean_headers(None) == ({}, None)
    assert clean_headers({}) == ({}, None)


@pytest.mark.parametrize("raw", [
    ["Authorization", "x"],
    {"Bad Name": "x"},
    {"": "x"},
    {"X-Ok": 5},
    {"X-Ok": "line1\nline2"},
    {"X-Ok": "a" * 5000},
    {f"H{i}": "v" for i in range(21)},
])
def test_clean_headers_rejects_bad_input(raw):
    headers, err = clean_headers(raw)
    assert headers is None and err


def test_error_messages_never_contain_the_value():
    _, err = clean_headers({"Authorization": SECRET + "\nInjected: 1"})
    assert "Authorization" in err and SECRET not in err


def test_header_names_only():
    assert header_names(HEADERS) == ["Authorization", "X-Team"]
    assert header_names(None) == []


def test_redact():
    assert redact(f"failed sending {SECRET}", HEADERS) == "failed sending ***"
    assert redact(None, HEADERS) is None
    assert redact("text", {}) == "text"


# ---- end to end through the API, without running Locust --------------------

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(job_store, "DB_PATH", str(tmp_path / "test.db"))
    job_store.init_db()
    dispatched = []
    monkeypatch.setattr(load_test_runner, "_dispatch_single",
                        lambda *args, **kwargs: dispatched.append(kwargs))
    c = app.test_client()
    c.dispatched = dispatched
    return c


def _whole_database_text():
    conn = sqlite3.connect(job_store.DB_PATH)
    try:
        return "\n".join(conn.iterdump())
    finally:
        conn.close()


@pytest.mark.parametrize("users", [10, 120])  # single run and split run
def test_api_run_stores_names_but_never_values(client, users):
    resp = client.post("/api/start-load-test", json={
        "i_own_target": True,
        "url": "http://127.0.0.1:8000/api/login", "confirmed_cases": CASES,
        "users": users, "spawn_rate": 1, "duration_seconds": 5, "headers": HEADERS,
    })
    assert resp.status_code == 202
    run_id = resp.get_json()["job_id"]

    # The values reached the runner (in memory) ...
    assert all(d["headers"] == HEADERS for d in client.dispatched)
    # ... but are nowhere in the database, the status, the history or compare.
    db_text = _whole_database_text()
    for value in HEADERS.values():
        assert value not in db_text
        assert value not in resp.get_data(as_text=True)
        assert value not in client.get(f"/api/load-test-status/{run_id}").get_data(as_text=True)
        assert value not in client.get("/api/jobs").get_data(as_text=True)
    assert "Authorization" in db_text
    status = client.get(f"/api/load-test-status/{run_id}").get_json()
    assert status["header_names"] == ["Authorization", "X-Team"]


def test_website_run_stores_names_but_never_values(client):
    resp = client.post("/api/start-website-load-test", json={
        "i_own_target": True,
        "url": "http://127.0.0.1:8000/", "users": 2, "spawn_rate": 1, "duration_seconds": 5,
        "headers": HEADERS,
    })
    assert resp.status_code == 202
    assert SECRET not in _whole_database_text()
    assert client.dispatched[0]["headers"] == HEADERS


def test_run_without_headers_still_works(client):
    resp = client.post("/api/start-load-test", json={
        "i_own_target": True,
        "url": "http://127.0.0.1:8000/api/login", "confirmed_cases": CASES,
        "users": 1, "spawn_rate": 1, "duration_seconds": 5,
    })
    assert resp.status_code == 202
    status = client.get(f"/api/load-test-status/{resp.get_json()['job_id']}").get_json()
    assert status.get("header_names") is None


def test_bad_headers_are_rejected(client):
    resp = client.post("/api/start-load-test", json={
        "i_own_target": True,
        "url": "http://t/", "confirmed_cases": CASES, "headers": {"Bad Name": "x"},
    })
    assert resp.status_code == 400
    assert client.dispatched == []


def test_headers_refused_in_sqs_mode(client, monkeypatch):
    monkeypatch.setattr(load_test_runner, "USE_SQS", True)
    resp = client.post("/api/start-load-test", json={
        "i_own_target": True,
        "url": "http://t/", "confirmed_cases": CASES, "headers": HEADERS,
    })
    assert resp.status_code == 409
    assert client.dispatched == []


def test_analyze_probe_sends_headers_and_never_returns_them(client, monkeypatch):
    seen = []

    class Resp:
        status_code = 401
        url = "http://t/api"
        headers = {"Content-Type": "application/json"}

    def fake_request(method, url, headers=None, **kwargs):
        seen.append(headers)
        return Resp()

    monkeypatch.setattr(sanity_module.requests, "request", fake_request)
    resp = client.post("/api/analyze", json={"url": "http://t/api", "headers": HEADERS})
    assert seen and seen[0] == HEADERS
    assert SECRET not in resp.get_data(as_text=True)


def test_probe_error_text_is_redacted(monkeypatch):
    def failing(method, url, headers=None, **kwargs):
        raise sanity_module.requests.exceptions.ConnectionError(f"could not send {SECRET}")

    monkeypatch.setattr(sanity_module.requests, "request", failing)
    monkeypatch.setattr(sanity_module.requests, "post",
                        lambda url, headers=None, **kw: failing("POST", url, headers))
    result = sanity_module.sanity_check("http://t/api", headers=HEADERS)
    assert SECRET not in result["error"] and "***" in result["error"]


# ---- the runner: values go only into Locust's environment -------------------

def test_runner_passes_values_via_env_only_and_writes_no_file(tmp_path, monkeypatch):
    monkeypatch.setattr(job_store, "DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setattr(load_test_runner, "RESULTS_DIR", str(tmp_path / "results"))
    job_store.init_db()
    captured = {}

    class FakeProc:
        returncode = 0

        def __init__(self, cmd, env=None, **kwargs):
            captured["cmd"], captured["env"] = cmd, env
            self.cmd = cmd

        def communicate(self, timeout=None):
            prefix = self.cmd[self.cmd.index("--csv") + 1]
            with open(prefix + "_stats.csv", "w") as f:
                f.write("Type,Name,Request Count,Failure Count\n,Aggregated,3,0\n")
            # Even if Locust echoed the value, it must not be stored.
            return f"stdout mentions {SECRET}", f"stderr mentions {SECRET}"

        def terminate(self):
            pass

    monkeypatch.setattr(subprocess, "Popen", FakeProc)
    job_store.create_job("j1", "http://t", 1, 1, 5, header_names=["Authorization", "X-Team"])
    load_test_runner._run_api_job("j1", "http://t", "/api", CASES, 1, 1, 5, HEADERS)

    assert '"Authorization"' in captured["env"]["LOCUST_HEADERS"]
    assert SECRET in captured["env"]["LOCUST_HEADERS"]
    assert all(SECRET not in part for part in captured["cmd"])

    # No file written for this run contains a value.
    for root, _, files in os.walk(tmp_path / "results"):
        for name in files:
            with open(os.path.join(root, name), encoding="utf-8") as f:
                assert SECRET not in f.read()
    job = job_store.get_job("j1")
    assert job["status"] == "completed"
    assert SECRET not in _whole_database_text()
    assert "***" in job["stdout"]
