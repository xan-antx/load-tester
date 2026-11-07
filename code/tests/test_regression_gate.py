"""scripts/regression_gate.py with mocked HTTP: no network, no server, no waiting."""
import importlib.util
import json
import os

import pytest
import requests

import job_store
from app import app

_PATH = os.path.join(os.path.dirname(__file__), "..", "scripts", "regression_gate.py")
_spec = importlib.util.spec_from_file_location("regression_gate", _PATH)
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)

BASELINE = {"id": "base-1", "users": 15, "created_at": "2026-10-18 10:00:00", "is_group": False}
NO_REGRESSIONS = {"baseline": BASELINE, "regressions": [], "baseline_p95": 160.0, "current_p95": 170.0,
                  "p95_change_pct": 6.2, "threshold": 10.0, "min_requests": 5}
WITH_REGRESSIONS = dict(NO_REGRESSIONS, regressions=[
    {"case": "zero_x", "baseline_rate": 0.0, "current_rate": 55.5, "increase": 55.5,
     "baseline_requests": 20, "current_requests": 100},
])


# ---- decision logic ----------------------------------------------------------

def test_no_regressions_passes():
    code, lines = gate.decide(NO_REGRESSIONS)
    assert code == gate.EXIT_OK
    assert any(line.startswith("PASS") for line in lines)
    assert any("160 ms -> 170 ms (+6.2%)" in line for line in lines)


def test_regressions_fail_and_are_listed():
    code, lines = gate.decide(WITH_REGRESSIONS)
    assert code == gate.EXIT_REGRESSIONS
    assert any("zero_x: 0.0% -> 55.5% (+55.5 pts)" in line for line in lines)


def test_missing_baseline_is_an_error():
    code, lines = gate.decide({"baseline": None, "baseline_id": None})
    assert code == gate.EXIT_ERROR
    assert "--baseline-id" in lines[0]


def test_unknown_p95_is_left_out():
    code, lines = gate.decide(dict(NO_REGRESSIONS, p95_change_pct=None))
    assert code == gate.EXIT_OK
    assert not any("p95" in line for line in lines)


# ---- argument handling ---------------------------------------------------------

def test_arguments_and_defaults():
    args = gate.parse_args(["--api", "http://h:5000/", "--url", "http://t/api", "--sample", "s.json"])
    assert args.api == "http://h:5000"
    assert (args.users, args.duration, args.spawn_rate) == (50, 30, 10)
    assert args.timeout == 330 and args.baseline_id is None and args.header == []


def test_headers_and_baseline_id():
    args = gate.parse_args(["--api", "a", "--url", "u", "--sample", "s", "--baseline-id", "b1",
                            "--header", "Authorization: Bearer x:y", "--header", "X-A:1"])
    assert args.baseline_id == "b1"
    assert args.header == [("Authorization", "Bearer x:y"), ("X-A", "1")]


@pytest.mark.parametrize("argv", [
    [],                                                       # required arguments missing
    ["--api", "a", "--url", "u", "--sample", "s", "--users", "0"],
    ["--api", "a", "--url", "u", "--sample", "s", "--users", "1001"],
    ["--api", "a", "--url", "u", "--sample", "s", "--duration", "abc"],
    ["--api", "a", "--url", "u", "--sample", "s", "--header", "no-colon"],
])
def test_bad_arguments_exit_with_2(argv, capsys):
    with pytest.raises(SystemExit) as exc:
        gate.parse_args(argv)
    assert exc.value.code == 2


# ---- the whole run, with a fake backend ------------------------------------------

class FakeResponse:
    def __init__(self, status_code, data):
        self.status_code, self._data = status_code, data

    def json(self):
        return self._data


class FakeHttp:
    """Answers like the backend. statuses: what successive status polls return."""

    def __init__(self, statuses=("running", "completed"), regressions=NO_REGRESSIONS, fail_on=None):
        self.statuses = list(statuses)
        self.regressions = regressions
        self.fail_on = fail_on
        self.calls = []

    def request(self, method, url, timeout=None, json=None, params=None):
        self.calls.append((method, url, json, params))
        if self.fail_on and self.fail_on in url:
            raise requests.ConnectionError("connection refused")
        if url.endswith("/api/generate-edge-cases"):
            return FakeResponse(200, {"cases": [{"label": "a"}, {"label": "b"}]})
        if url.endswith("/api/confirm-selection"):
            return FakeResponse(200, {"confirmed_cases": [{"label": "a"}, {"label": "b"}]})
        if url.endswith("/api/start-load-test"):
            return FakeResponse(202, {"job_id": "run-9"})
        if url.endswith("/api/load-test-status/missing"):
            return FakeResponse(404, {"error": "job_id not found"})
        if url.endswith("/api/load-test-status/base-1"):
            return FakeResponse(200, {"status": "completed"})
        if "/api/load-test-status/" in url:
            return FakeResponse(200, {"status": self.statuses.pop(0)})
        if "/api/regressions/" in url:
            if params and params.get("baseline_id") == "missing":
                return FakeResponse(404, {"error": "baseline run 'missing' not found"})
            return FakeResponse(200, self.regressions)
        return FakeResponse(404, {"error": "not_found"})


@pytest.fixture
def args(tmp_path):
    sample = tmp_path / "sample.json"
    sample.write_text(json.dumps({"username": "demo"}))
    return gate.parse_args(["--api", "http://api", "--url", "http://t/api/login",
                            "--sample", str(sample), "--users", "50", "--duration", "5"])


def _run(args, http):
    lines = []
    code = gate.run_gate(args, http=http, sleep=lambda s: None, out=lines.append)
    return code, lines


def test_full_run_without_regressions_exits_0(args):
    http = FakeHttp()
    code, lines = _run(args, http)
    assert code == 0
    start_body = next(c[2] for c in http.calls if c[1].endswith("/start-load-test"))
    assert start_body["users"] == 50 and start_body["duration_seconds"] == 5
    assert start_body["confirmed_cases"] == [{"label": "a"}, {"label": "b"}]
    assert "headers" not in start_body
    assert lines[0].startswith("Started run run-9")


def test_full_run_with_regressions_exits_1(args):
    code, _ = _run(args, FakeHttp(regressions=WITH_REGRESSIONS))
    assert code == 1


def test_baseline_id_and_headers_are_passed_on(args):
    args.baseline_id = "base-1"
    args.header = [("Authorization", "Bearer t")]
    http = FakeHttp()
    _run(args, http)
    regress_call = next(c for c in http.calls if "/api/regressions/" in c[1])
    assert regress_call[3] == {"baseline_id": "base-1"}
    start_body = next(c[2] for c in http.calls if c[1].endswith("/start-load-test"))
    assert start_body["headers"] == {"Authorization": "Bearer t"}


@pytest.mark.parametrize("statuses", [("running", "failed"), ("cancelled",), ("timeout",)])
def test_run_that_does_not_complete_is_an_error(args, statuses):
    with pytest.raises(gate.GateError, match="did not complete"):
        _run(args, FakeHttp(statuses=statuses))


def test_gives_up_after_the_timeout(args):
    args.timeout, args.poll_interval = 6, 2
    http = FakeHttp(statuses=["running"] * 10)
    with pytest.raises(gate.GateError, match="status: running"):
        _run(args, http)
    assert sum("/load-test-status/" in c[1] for c in http.calls) == 3


def test_unreachable_backend_is_an_error(args):
    with pytest.raises(gate.GateError, match="cannot reach the backend"):
        _run(args, FakeHttp(fail_on="generate-edge-cases"))


def test_unknown_baseline_id_is_an_error_before_any_run_starts(args):
    args.baseline_id = "missing"
    http = FakeHttp()
    with pytest.raises(gate.GateError, match="404"):
        _run(args, http)
    assert not any(c[1].endswith("/start-load-test") for c in http.calls)


def test_bad_sample_file_is_an_error(args, tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("[1, 2]")
    args.sample = str(bad)
    with pytest.raises(gate.GateError, match="JSON object"):
        _run(args, FakeHttp())
    args.sample = str(tmp_path / "nope.json")
    with pytest.raises(gate.GateError, match="cannot read"):
        _run(args, FakeHttp())


def test_main_turns_errors_into_exit_code_2(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(gate, "run_gate", lambda args: (_ for _ in ()).throw(gate.GateError("boom")))
    code = gate.main(["--api", "a", "--url", "u", "--sample", "s"])
    assert code == 2
    assert "ERROR: boom" in capsys.readouterr().err


# ---- the backend side: ?baseline_id= on /api/regressions -------------------------

STATS = "Type,Name,Request Count,Failure Count,95%\nPOST,a,20,{f},100\n,Aggregated,20,{f},100\n"


def test_regressions_endpoint_accepts_explicit_baseline(tmp_path, monkeypatch):
    monkeypatch.setattr(job_store, "DB_PATH", str(tmp_path / "t.db"))
    job_store.init_db()
    for job_id, failures in (("old", 0), ("new", 10)):
        job_store.create_job(job_id, "http://t", 15, 1, 10)
        job_store.update_job(job_id, status="completed", stats_csv=STATS.format(f=failures))
    client = app.test_client()

    stored = client.get("/api/regressions/new").get_json()
    assert stored["baseline"] is None  # nothing marked as baseline

    explicit = client.get("/api/regressions/new?baseline_id=old").get_json()
    assert explicit["baseline"]["id"] == "old"
    assert [r["case"] for r in explicit["regressions"]] == ["a"]

    assert client.get("/api/regressions/new?baseline_id=nope").status_code == 404
