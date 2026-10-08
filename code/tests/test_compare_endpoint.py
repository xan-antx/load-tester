import pytest

import job_store
from app import app

STATS_HEADER = "Type,Name,Request Count,Failure Count,Average Response Time,Requests/s,95%\n"


def _stats(*rows):
    lines = [f"POST,{n},{r},{f},100,1.0,150" for n, r, f in rows]
    lines.append(f",Aggregated,{sum(r for _, r, _ in rows)},{sum(f for _, _, f in rows)},100,1.0,150")
    return STATS_HEADER + "\n".join(lines) + "\n"


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Point the job store at a throwaway database for this test only.
    monkeypatch.setattr(job_store, "DB_PATH", str(tmp_path / "test.db"))
    job_store.init_db()
    return app.test_client()


def _make_job(job_id, users, stats_csv):
    job_store.create_job(job_id, "http://target", users, 1, 10)
    job_store.update_job(job_id, status="completed", stats_csv=stats_csv)


def test_compare_with_job_ids_returns_runs_in_order(client):
    _make_job("a", 15, _stats(("zero_x", 20, 0), ("null_p", 20, 20)))
    _make_job("b", 50, _stats(("zero_x", 20, 1), ("null_p", 20, 20)))
    _make_job("c", 150, _stats(("zero_x", 20, 8), ("null_p", 20, 20)))

    resp = client.post("/api/compare-jobs", json={"job_ids": ["c", "a", "b"]})
    assert resp.status_code == 200
    body = resp.get_json()
    assert [j["job_id"] for j in body["jobs"]] == ["c", "a", "b"]
    assert all("failure_summary" in j for j in body["jobs"])
    first = body["case_comparison"]["rows"][0]
    assert first["case"] == "zero_x" and first["changed"] is True


@pytest.mark.parametrize("ids", [["a"], ["a", "b", "c", "d", "e"], "a,b", ["a", ""]])
def test_compare_rejects_bad_job_ids(client, ids):
    resp = client.post("/api/compare-jobs", json={"job_ids": ids})
    assert resp.status_code == 400


def test_compare_unknown_id_is_404(client):
    _make_job("a", 15, _stats(("x", 5, 0)))
    resp = client.post("/api/compare-jobs", json={"job_ids": ["a", "missing"]})
    assert resp.status_code == 404


def test_old_two_run_request_still_works(client):
    _make_job("a", 15, _stats(("x", 5, 0)))
    _make_job("b", 50, _stats(("x", 5, 5)))
    resp = client.post("/api/compare-jobs", json={"job_id_a": "a", "job_id_b": "b"})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["job_a"]["job_id"] == "a" and body["job_b"]["job_id"] == "b"
    assert "jobs" not in body
