"""cli.py with mocked HTTP: config + flags, case selection, exit codes,
capacity mode and the files it writes. No network, no server, no waiting."""
import json
import os

import pytest
import requests

import cli

SAMPLE = {"username": "demo", "password": "demo123"}
GENERATED = [{"label": "valid_sample", "expect": "accept"}, {"label": "null_username", "expect": "reject"},
             {"label": "very_long_string_username", "expect": "reject"}]
STATS = "Type,Name,Request Count,Failure Count,Average Response Time,Requests/s,95%\n,Aggregated,100,2,120,8.5,300\n"


def verdict(result):
    return {"verdict": result, "passed": 1, "failed": int(result == "FAIL"), "not_measured": 0, "checks": [
        {"key": "p95_ms", "label": "p95 response time", "unit": "ms", "comparison": "<=",
         "target": 500, "actual": 300.0, "passed": result == "PASS"}]}


class FakeResponse:
    def __init__(self, status_code, data):
        self.status_code, self._data = status_code, data

    def json(self):
        return self._data


class FakeBackend:
    """Answers like the backend. final: the last status poll's body."""

    def __init__(self, final=None, classification="api", polls=("running",), fail_on=None):
        self.final = final or {"job_id": "run-1", "status": "completed", "stats_csv": STATS,
                               "slo_verdict": verdict("PASS"), "outcome_summary": None, "failure_summary": []}
        self.classification = classification
        self.polls = list(polls)
        self.fail_on = fail_on
        self.calls = []

    def request(self, method, url, timeout=None, json=None, params=None):
        self.calls.append((method, url, json))
        if self.fail_on and self.fail_on in url:
            raise requests.ConnectionError("refused")
        if url.endswith("/api/health"):
            return FakeResponse(200, {"status": "ok"})
        if url.endswith("/api/analyze"):
            return FakeResponse(200, {"type_detection": {"classification": self.classification}, "sitemap": {}})
        if url.endswith("/api/generate-edge-cases"):
            return FakeResponse(200, {"cases": GENERATED})
        if url.endswith("/api/confirm-selection"):
            chosen = [{"label": l, "expect": "reject"} for l in json["selected_labels"]]
            return FakeResponse(200, {"confirmed_cases": chosen})
        if url.endswith("/api/start-load-test") or url.endswith("/api/start-website-load-test"):
            return FakeResponse(202, {"job_id": "run-1"})
        if "/api/load-test-status/" in url:
            if self.polls:
                return FakeResponse(200, {"status": self.polls.pop(0)})
            return FakeResponse(200, self.final)
        return FakeResponse(404, {"error": "not_found"})

    def body(self, suffix):
        return next(c[2] for c in self.calls if c[1].endswith(suffix))


@pytest.fixture
def config_file(tmp_path):
    def write(extra=""):
        path = tmp_path / "lt.yml"
        path.write_text(f"""
api: http://backend:5000
target:
  url: http://127.0.0.1:8000/api/login
  i_own_target: true
sample: {json.dumps(SAMPLE)}
load:
  users: 15
  spawn_rate: 15
  duration_seconds: 20
slo:
  p95_ms: 500
output:
  dir: {tmp_path / 'out'}
{extra}""")
        return str(path)
    return write


def _main(argv, backend):
    lines = []
    code = cli.main(argv, http=backend, sleep=lambda s: None, out=lines.append)
    return code, "\n".join(lines)


# ---- exit codes and outputs --------------------------------------------------------

def test_slo_pass_exits_0_and_writes_report_json_and_summary(config_file, tmp_path):
    backend = FakeBackend()
    code, text = _main(["run", "--config", config_file()], backend)
    assert code == 0
    assert "SLO verdict: PASS" in text
    out = tmp_path / "out"
    assert sorted(os.listdir(out)) == ["report-run-1.md", "result-run-1.json", "summary.md"]
    assert "| p95 response time | ≤ 500 ms | 300.0 ms | ✅ met |" in (out / "summary.md").read_text(encoding="utf-8")
    result = json.loads((out / "result-run-1.json").read_text(encoding="utf-8"))
    assert result["exit_code"] == 0 and result["status"]["status"] == "completed"
    start = backend.body("/api/start-load-test")
    assert start["users"] == 15 and start["slo"] == {"p95_ms": 500} and start["i_own_target"] is True


def test_slo_fail_exits_1(config_file):
    final = {"job_id": "run-1", "status": "completed", "stats_csv": STATS, "slo_verdict": verdict("FAIL")}
    code, text = _main(["run", "--config", config_file()], FakeBackend(final=final))
    assert code == 1 and "MISSED" in text


@pytest.mark.parametrize("status", ["failed", "timeout", "cancelled"])
def test_run_that_does_not_complete_exits_2(config_file, status):
    code, _ = _main(["run", "--config", config_file()], FakeBackend(final={"job_id": "run-1", "status": status}))
    assert code == 2


def test_unreachable_backend_exits_2(config_file, capsys):
    code, _ = _main(["run", "--config", config_file()], FakeBackend(fail_on="/api/health"))
    assert code == 2 and "cannot reach the backend" in capsys.readouterr().err


def test_slo_set_but_nothing_measured_is_a_fail():
    cfg = {"mode": "fixed", "slo": {"max_unexpected_outcome_rate_pct": 1}, "capacity": {}}
    assert cli.decide(cfg, {"status": "completed", "slo_verdict": {"verdict": None}}) == 1
    assert cli.decide({**cfg, "slo": {}}, {"status": "completed", "slo_verdict": None}) == 0


# ---- config and flags ------------------------------------------------------------------

def test_flags_override_the_config(config_file):
    backend = FakeBackend()
    _main(["run", "--config", config_file(), "--users", "40", "--duration", "10", "--slo-p95-ms", "250",
           "--slo-server-error-pct", "2", "--api", "http://other:1/", "--header", "Authorization: Bearer t"], backend)
    start = backend.body("/api/start-load-test")
    assert start["users"] == 40 and start["duration_seconds"] == 10
    assert start["slo"] == {"p95_ms": 250, "max_server_error_rate_pct": 2}
    assert start["headers"] == {"Authorization": "Bearer t"}
    assert backend.calls[0][1] == "http://other:1/api/health"


def test_header_values_are_not_written_to_the_result_file(config_file, tmp_path):
    _main(["run", "--config", config_file(), "--header", "Authorization: Bearer s3cret"], FakeBackend())
    for name in os.listdir(tmp_path / "out"):
        assert "s3cret" not in (tmp_path / "out" / name).read_text(encoding="utf-8")


def test_api_url_from_the_environment(tmp_path):
    args = cli.parse_args(["run", "--url", "http://t/x", "--i-own-target", "--sample", '{"a": 1}'])
    cfg = cli.load_config(args, environ={"ELEVATE_API": "http://env:9/"})
    assert cfg["api"] == "http://env:9" and cfg["sample"] == {"a": 1} and cfg["mode"] == "fixed"


@pytest.mark.parametrize("argv, message", [
    (["run", "--sample", '{"a": 1}', "--i-own-target"], "no target URL"),
    (["run", "--url", "http://t/x", "--sample", '{"a": 1}'], "i_own_target"),
    (["run", "--url", "http://t/x", "--i-own-target", "--header", "nocolon"], "Name: value"),
    (["run", "--url", "http://t/x", "--i-own-target", "--sample", "{not json"], "valid JSON"),
    (["run", "--config", "missing.yml"], "cannot read config"),
])
def test_bad_configuration_exits_2(argv, message, capsys):
    code, _ = _main(argv, FakeBackend())
    assert code == 2 and message in capsys.readouterr().err


def test_unknown_slo_key_is_rejected(tmp_path, capsys):
    path = tmp_path / "bad.yml"
    path.write_text("target:\n  url: http://t/x\n  i_own_target: true\nslo:\n  p99_ms: 100\n")
    code, _ = _main(["run", "--config", str(path)], FakeBackend())
    assert code == 2 and "unknown SLO threshold(s): p99_ms" in capsys.readouterr().err


# ---- case selection ---------------------------------------------------------------------

def test_select_cases_include_exclude_expect():
    labels, expect = cli.select_cases(GENERATED, {"exclude": ["very_long_string_username"],
                                                  "expect": {"null_username": "accept"}})
    assert labels == ["valid_sample", "null_username"] and expect == {"null_username": "accept"}
    labels, _ = cli.select_cases(GENERATED, {"include": ["valid_sample"]})
    assert labels == ["valid_sample"]


@pytest.mark.parametrize("cases, message", [
    ({"include": ["nope"]}, "unknown case label"),
    ({"include": ["valid_sample"], "exclude": ["valid_sample"]}, "no cases left"),
    ({"expect": {"valid_sample": "maybe"}}, "accept or reject"),
])
def test_select_cases_errors(cases, message):
    with pytest.raises(cli.CliError, match=message):
        cli.select_cases(GENERATED, cases)


def test_cases_flag_and_expectations_reach_the_backend(config_file):
    backend = FakeBackend()
    _main(["run", "--config", config_file("cases:\n  expect:\n    null_username: accept\n"),
           "--cases", "valid_sample,null_username"], backend)
    confirm = backend.body("/api/confirm-selection")
    assert confirm["selected_labels"] == ["valid_sample", "null_username"]
    assert confirm["expectations"] == {"null_username": "accept"}


def test_website_targets_skip_case_generation(config_file):
    backend = FakeBackend(classification="website")
    code, _ = _main(["run", "--config", config_file()], backend)
    assert code == 0
    assert not any(c[1].endswith("/api/generate-edge-cases") for c in backend.calls)
    assert backend.body("/api/start-website-load-test")["i_own_target"] is True


# ---- capacity mode ----------------------------------------------------------------------

CAPACITY = {"headline": "Max sustainable: 120 users at p95 < 500 ms", "max_sustainable_users": 120,
            "breaking_point_users": 140, "breaking_reason": "p95 response time 580 ms > 500 ms",
            "steps": [{"planned_users": 120, "rps": 78.8, "p95_ms": 310, "server_error_rate_pct": 0.0,
                       "verdict": "PASS", "complete": True}]}


@pytest.mark.parametrize("min_users, code", [(None, 0), (100, 0), (150, 1)])
def test_capacity_mode_exit_code_follows_sustained_users(config_file, min_users, code):
    extra = "capacity:\n  start_users: 20\n  step_users: 20\n  step_duration_seconds: 12\n  max_users: 200\n"
    if min_users:
        extra += f"  min_users: {min_users}\n"
    final = {"job_id": "run-1", "status": "completed", "stats_csv": STATS, "mode": "capacity",
             "capacity": CAPACITY, "slo_verdict": None}
    backend = FakeBackend(final=final)
    got, text = _main(["run", "--config", config_file(extra), "--mode", "capacity"], backend)
    assert got == code and "Max sustainable: 120 users" in text
    start = backend.body("/api/start-load-test")
    assert start["mode"] == "capacity" and start["capacity"]["max_users"] == 200
    assert "min_users" not in start["capacity"]


def test_capacity_without_any_sustained_step_fails():
    cfg = {"mode": "capacity", "slo": {"p95_ms": 500}, "capacity": {"start_users": 20}}
    status = {"status": "completed", "capacity": {"max_sustainable_users": None}}
    assert cli.decide(cfg, status) == 1


def test_gives_up_after_the_timeout(config_file, capsys):
    backend = FakeBackend(polls=["running"] * 100)
    code, _ = _main(["run", "--config", config_file(), "--timeout", "6"], backend)
    assert code == 2 and "did not finish" in capsys.readouterr().err


def test_split_run_marks_p95_as_approximate(config_file, tmp_path):
    """A split run's p95 is merged from parallel Locust processes, so the
    console (ASCII "~") and the Markdown files ("≈") label it approximate."""
    final = {"group_id": "run-1", "status": "completed", "stats_csv": STATS, "slo_verdict": verdict("PASS"),
             "outcome_summary": None, "failure_summary": [], "child_jobs": [{}, {}, {}]}
    code, text = _main(["run", "--config", config_file()], FakeBackend(final=final))
    assert code == 0
    assert "split into 3 parallel Locust processes; p95 approximate" in text
    assert "| p95 response time | <= 500 ms | ~300.0 ms | met |" in text
    out = tmp_path / "out"
    assert "| p95 response time | ≤ 500 ms | ≈300.0 ms | ✅ met |" in (out / "summary.md").read_text(encoding="utf-8")
    report = (out / "report-run-1.md").read_text(encoding="utf-8")
    assert "- Locust processes: 3, in parallel on the same host" in report
    assert "| p95 response | ≈300 ms (approximate, split run) |" in report


def test_single_process_run_has_no_approximate_marks(config_file, tmp_path):
    code, text = _main(["run", "--config", config_file()], FakeBackend())
    report = (tmp_path / "out" / "report-run-1.md").read_text(encoding="utf-8")
    assert "~" not in text and "≈" not in report and "- Locust processes: 1" in report
