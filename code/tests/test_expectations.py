"""Expected outcomes: generated cases, confirmation, the Locust-side
classifier, failure grouping, outcome summary, split merging and the mock's
deliberate validation bug."""
import importlib.util
import os

import pytest

import job_store
import load_test_runner
from analysis.edge_cases import generate_edge_cases
from analysis.failure_summary import summarize_failures
from analysis.outcome_summary import outcome_summary, server_error_rate
from app import app
from locust_tests.expectations import classify_outcome, failure_message
from stats_aggregator import merge_failures_csvs

SAMPLE = {"username": "demo", "password": "demo123", "expiresInMins": 30}


# ---- generated cases ------------------------------------------------------------

def test_every_case_has_an_expectation_and_the_sample_comes_first():
    cases = generate_edge_cases(SAMPLE)
    assert all(c["expect"] in ("accept", "reject") for c in cases)
    first = cases[0]
    assert first["label"] == "valid_sample" and first["expect"] == "accept"
    assert first["payload"] == SAMPLE and first["payload"] is not SAMPLE


def test_expectations_per_generator():
    by_label = {c["label"]: c["expect"] for c in generate_edge_cases(SAMPLE)}
    for label in ("missing_username", "null_password", "wrong_type_expiresInMins",
                  "empty_string_username", "very_long_string_username", "negative_expiresInMins",
                  "very_large_expiresInMins", "sqli_username_0", "xss_password_1"):
        assert by_label[label] == "reject", label
    assert by_label["zero_expiresInMins"] == "accept"  # zero is usually a valid number


# ---- /api/confirm-selection ---------------------------------------------------------

def _confirm(body):
    return app.test_client().post("/api/confirm-selection", json={"sample_input": SAMPLE, **body})


def test_confirmed_cases_carry_expectations_and_overrides():
    resp = _confirm({"selected_labels": ["valid_sample", "missing_expiresInMins", "null_username"],
                     "expectations": {"missing_expiresInMins": "accept"}})
    assert resp.status_code == 200
    got = {c["label"]: c["expect"] for c in resp.get_json()["confirmed_cases"]}
    assert got == {"valid_sample": "accept", "missing_expiresInMins": "accept", "null_username": "reject"}


@pytest.mark.parametrize("expectations", [{"null_username": "maybe"}, ["accept"], {"x": None}])
def test_bad_expectation_overrides_are_rejected(expectations):
    resp = _confirm({"selected_labels": ["null_username"], "expectations": expectations})
    assert resp.status_code == 400


def test_custom_cases_default_to_reject_and_may_choose_accept():
    customs = [
        {"label": "admin_user", "payload": {**SAMPLE, "username": "admin"}},
        {"label": "short_expiry", "payload": {**SAMPLE, "expiresInMins": 5}, "expect": "accept"},
    ]
    resp = _confirm({"custom_cases": customs})
    got = {c["label"]: c["expect"] for c in resp.get_json()["confirmed_cases"]}
    assert got == {"admin_user": "reject", "short_expiry": "accept"}


def test_custom_case_with_invalid_expectation_is_rejected():
    resp = _confirm({"custom_cases": [{"label": "c1", "payload": {**SAMPLE, "username": "x"}, "expect": "2xx"}]})
    assert resp.status_code == 400 and "expect" in resp.get_json()["error"]


# ---- start-load-test stores the expectations -----------------------------------------

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(job_store, "DB_PATH", str(tmp_path / "test.db"))
    job_store.init_db()
    monkeypatch.setattr(load_test_runner, "_dispatch_single", lambda *a, **k: None)
    return app.test_client()


def _start(client, cases, users=10):
    return client.post("/api/start-load-test", json={
        "url": "http://127.0.0.1:8000/api/login", "confirmed_cases": cases, "users": users,
        "spawn_rate": 1, "duration_seconds": 5, "i_own_target": True,
    })


@pytest.mark.parametrize("users", [10, 120])
def test_expectations_are_stored_with_single_and_split_runs(client, users):
    cases = [{"label": "valid_sample", "payload": SAMPLE, "expect": "accept"},
             {"label": "null_username", "payload": {**SAMPLE, "username": None}, "expect": "reject"}]
    run_id = _start(client, cases, users).get_json()["job_id"]
    status = client.get(f"/api/load-test-status/{run_id}").get_json()
    assert status["case_expectations"] == {"valid_sample": "accept", "null_username": "reject"}


def test_cases_without_expectations_still_start(client):
    resp = _start(client, [{"label": "a", "payload": {"x": 1}}])
    assert resp.status_code == 202
    status = client.get(f"/api/load-test-status/{resp.get_json()['job_id']}").get_json()
    assert status["case_expectations"] is None and status["outcome_summary"] is None


def test_invalid_expect_on_a_started_case_is_rejected(client):
    resp = _start(client, [{"label": "a", "payload": {"x": 1}, "expect": "sometimes"}])
    assert resp.status_code == 400


# ---- the classifier used inside Locust ---------------------------------------------

@pytest.mark.parametrize("status, expect, result", [
    (200, "accept", (True, None)),
    (201, "accept", (True, None)),
    (400, "reject", (True, None)),
    (422, "reject", (True, None)),
    (200, "reject", (False, "accepted_invalid_input")),
    (400, "accept", (False, "rejected_valid_input")),
    (401, "accept", (False, "rejected_valid_input")),
    (429, "reject", (False, "rate_limited")),
    (429, "accept", (False, "rate_limited")),
    (500, "reject", (False, "server_error")),
    (503, "accept", (False, "server_error")),
    (0, "accept", (False, "connection")),
    (None, "reject", (False, "connection")),
    (304, "accept", (False, "unexpected_status")),
])
def test_classify_outcome(status, expect, result):
    assert classify_outcome(status, expect) == result


def test_failure_messages_lead_with_the_category():
    assert failure_message("accepted_invalid_input", 200, "reject") == \
        "accepted_invalid_input (200): expected a 4xx rejection, got 200"
    assert failure_message("rejected_valid_input", 400, "accept").startswith("rejected_valid_input (400)")
    assert failure_message("connection", 0, "accept", "refused").startswith("connection: no response")


# ---- grouping real Locust failure lines ------------------------------------------------

HEADER = "Method,Name,Error,Occurrences,First Seen,Last Seen\n"
REAL_ROWS = [
    ("very_long_string_username", "accepted_invalid_input (200): expected a 4xx rejection, got 200", 4),
    ("null_expiresInMins", "accepted_invalid_input (200): expected a 4xx rejection, got 200", 7),
    ("valid_sample", "rejected_valid_input (400): expected a 2xx success, got 400", 2),
    ("very_large_expiresInMins", "server_error (500): expected a 4xx rejection, got 500", 5),
    ("valid_sample", "rate_limited (429): expected a 2xx success, got 429", 3),
    ("null_username", "connection: no response (ConnectionRefusedError)", 1),
]


def _failures_csv(rows):
    return HEADER + "".join(f'POST,{n},"CatchResponseError(\'{e}\')",{k},t1,t2\n' for n, e, k in rows)


def test_new_categories_are_grouped_with_meanings():
    groups = {(g["kind"], g["code"]): g for g in summarize_failures(_failures_csv(REAL_ROWS))}
    accepted = groups[("accepted_invalid_input", 200)]
    assert accepted["total"] == 11
    assert "validation bug" in accepted["meaning"]
    assert [c["case"] for c in accepted["cases"]] == ["null_expiresInMins", "very_long_string_username"]
    assert groups[("rejected_valid_input", 400)]["total"] == 2
    assert groups[("server_error", 500)]["total"] == 5
    assert groups[("rate_limited", 429)]["total"] == 3
    assert groups[("connection", None)]["total"] == 1


def test_split_run_failures_still_merge():
    child_a = _failures_csv(REAL_ROWS[:2])
    child_b = _failures_csv(REAL_ROWS[:1] + REAL_ROWS[3:4])
    merged = summarize_failures(merge_failures_csvs([child_a, child_b]))
    totals = {g["kind"]: g["total"] for g in merged}
    assert totals == {"accepted_invalid_input": 4 + 7 + 4, "server_error": 5}


# ---- outcome summary ---------------------------------------------------------------------

STATS = "Type,Name,Request Count,Failure Count\n,Aggregated,100,22\n"


def test_outcome_summary_counts_handled_correctly_and_unexpected():
    summary = outcome_summary(summarize_failures(_failures_csv(REAL_ROWS)), STATS, {"valid_sample": "accept"})
    assert summary["total_requests"] == 100
    assert summary["handled_correctly"] == 100 - 22
    assert summary["handled_correctly_pct"] == 78.0
    assert summary["accepted_invalid_input"] == 11 and summary["rejected_valid_input"] == 2
    assert summary["unexpected_outcome_count"] == 13 and summary["unexpected_outcome_rate_pct"] == 13.0
    assert summary["server_error_rate_pct"] == 6.0  # 5 server errors + 1 connection failure
    assert summary["rate_limited"] == 3


def test_outcome_summary_needs_expectations():
    assert outcome_summary([], STATS, None) is None
    assert outcome_summary([], STATS, {}) is None


def test_server_error_rate_for_any_run():
    legacy = [{"kind": "server_error", "total": 3}, {"kind": "rejected", "total": 50},
              {"kind": "connection", "total": 1}]
    assert server_error_rate(legacy, STATS) == 4.0
    assert server_error_rate(legacy, None) is None


# ---- the mock target's deliberate validation bug -------------------------------------------

def _mock_app(monkeypatch):
    path = os.path.join(os.path.dirname(__file__), "..", "scripts", "mock_target.py")
    spec = importlib.util.spec_from_file_location("mock_target", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module.time, "sleep", lambda s: None)  # no artificial latency in tests
    return module.app.test_client()


def test_mock_accepts_an_overlong_username(monkeypatch):
    mock = _mock_app(monkeypatch)
    buggy = mock.post("/api/login", json={**SAMPLE, "username": "A" * 5000})
    assert buggy.status_code == 200  # the deliberate bug
    assert mock.post("/api/login", json={**SAMPLE, "username": "A" * 50}).status_code == 400
    assert mock.post("/api/login", json=SAMPLE).status_code == 200
    assert mock.post("/api/login", json={**SAMPLE, "password": "A" * 5000}).status_code == 400
