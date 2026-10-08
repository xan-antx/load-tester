import pytest

import job_store
from app import app

HEADER = "Type,Name,Request Count,Failure Count,95%\n"


def _stats(rows, p95):
    lines = [f"POST,{n},{r},{f},100" for n, r, f in rows]
    lines.append(f",Aggregated,{sum(r for _, r, _ in rows)},{sum(f for _, _, f in rows)},{p95}")
    return HEADER + "\n".join(lines) + "\n"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(job_store, "DB_PATH", str(tmp_path / "test.db"))
    job_store.init_db()
    return app.test_client()


def _job(job_id, stats, target="http://target", status="completed"):
    job_store.create_job(job_id, target, 15, 1, 10)
    job_store.update_job(job_id, status=status, stats_csv=stats)


GOOD = _stats([("zero_x", 20, 0), ("null_p", 20, 20)], 200)
WORSE = _stats([("zero_x", 20, 8), ("null_p", 20, 20)], 260)


def test_no_baseline_yet(client):
    _job("a", GOOD)
    body = client.get("/api/regressions/a").get_json()
    assert body["baseline_id"] is None and body["baseline"] is None


def test_mark_baseline_then_compare_a_later_run(client):
    _job("a", GOOD)
    _job("b", WORSE)
    assert client.post("/api/baseline", json={"id": "a"}).status_code == 200

    body = client.get("/api/regressions/b").get_json()
    assert body["baseline_id"] == "a"
    assert body["baseline"]["id"] == "a"
    assert [r["case"] for r in body["regressions"]] == ["zero_x"]
    assert body["p95_change_pct"] == 30.0

    own = client.get("/api/regressions/a").get_json()
    assert own["is_current_baseline"] is True
    assert own["baseline"] is None


def test_only_one_baseline_per_target(client):
    _job("a", GOOD)
    _job("b", WORSE)
    _job("other", GOOD, target="http://elsewhere")
    client.post("/api/baseline", json={"id": "a"})
    client.post("/api/baseline", json={"id": "other"})
    client.post("/api/baseline", json={"id": "b"})
    assert client.get("/api/baseline?target_url=http://target").get_json()["baseline_id"] == "b"
    assert client.get("/api/baseline?target_url=http://elsewhere").get_json()["baseline_id"] == "other"


def test_unfinished_or_unknown_runs_cannot_be_baseline(client):
    _job("running", GOOD, status="running")
    assert client.post("/api/baseline", json={"id": "running"}).status_code == 400
    assert client.post("/api/baseline", json={"id": "nope"}).status_code == 404
    assert client.post("/api/baseline", json={}).status_code == 400


def test_jobs_list_reports_baseline_flag(client):
    _job("a", GOOD)
    client.post("/api/baseline", json={"id": "a"})
    jobs = client.get("/api/jobs").get_json()["jobs"]
    assert jobs[0]["is_baseline"] == 1
