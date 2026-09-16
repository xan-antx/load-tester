# Elevate Load Tester — Code

Flask backend + React frontend for analyzing HTTP targets and running
asynchronous Locust load tests. See [RUNBOOK.md](RUNBOOK.md) for the full run
guide and known limitations.

## Tech stack

- **Backend:** Python 3, Flask, flask-cors, Locust, SQLite (job store), boto3 (optional SQS queue mode)
- **Frontend:** React 18 + Vite
- **CI/CD:** GitLab CI (test → build → deploy) onto a k3s cluster (`k8s/`)

## Setup & run

Backend (serves on `http://localhost:5000`):

``` shell
pip install -r requirements.txt
python app.py
```

Frontend (serves on `http://localhost:5173`):

``` shell
cd frontend
npm install
npm run dev
```

The frontend defaults to a backend at `http://localhost:5000`; override with
`VITE_API_BASE` in `frontend/.env` (see `frontend/.env.example`).

## Tests

``` shell
pip install pytest
python -m pytest
```

Manual smoke-check scripts (require the backend running) live in
[scripts/](scripts/README.md).

## Layout

- `app.py` — Flask API (analyze, edge cases, load test jobs, compare)
- `analysis/` — URL sanity check, API/website type detection, edge-case generation
- `load_test_runner.py` — runs Locust tests in background threads; splits runs >50 users into child jobs
- `stats_aggregator.py` — merges child-job stats CSVs
- `job_store.py` — SQLite persistence for jobs and job groups
- `worker.py`, `sqs_client.py`, `Dockerfile.worker` — optional SQS queue mode (not deployed yet)
- `frontend/` — React UI
- `k8s/` — deployment manifests; `.gitlab-ci.yml` — CI pipeline
