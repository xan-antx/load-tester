# Elevate Load Tester — Code

Flask backend + React frontend for analyzing HTTP targets and running
asynchronous Locust load tests. The project overview, architecture diagram and
known limitations are in the [root README](../README.md); see
[RUNBOOK.md](RUNBOOK.md) for the full run guide (simple and queue mode).

## Tech stack

- **Backend:** Python 3, Flask, flask-cors, Locust, SQLite (job store), boto3 (SQS queue mode: not deployed, future work)
- **Frontend:** React 18 + Vite
- **CI/CD:** **GitHub Actions is the primary pipeline** (`.github/workflows/ci.yml`):
  backend tests, frontend lint + build, a performance gate against the mock target
  (via `cli.py`), and on pushes to `main` a Docker image pushed to
  `ghcr.io/xan-antx/load-tester` (used by `k8s/deployment.yaml`). The older GitLab CI
  pipeline (`.gitlab-ci.yml`: test → build → deploy to k3s with readiness and liveness
  probes on `/health`, plus a manual `regression-gate` job) is kept for reference.

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

Jobs run in-process as background threads. The SQS queue mode (`USE_SQS=true`
plus `worker.py`) is **not deployed — future work**: the deployed backend runs with
`USE_SQS=false`.

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `FLASK_DEBUG` | off | `1` turns on Flask's debug mode (reloader + debugger) for `python app.py`. Never in production. |
| `HOST` / `PORT` | `127.0.0.1` / `5000` | Where `python app.py` listens. The container uses gunicorn on `0.0.0.0:5000`. |
| `ALLOW_PRIVATE_TARGETS` | `true` | Allow targets on private, loopback, link-local and multicast addresses (the mock target on 127.0.0.1). `k8s/deployment.yaml` sets `false`. Cloud metadata addresses are always refused. |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Browser origins allowed to call the API (comma-separated). |
| `DB_PATH` | `load_tests.db` | SQLite database file. |
| `USE_SQS` | `false` | Queue mode (not deployed — future work). |
| `MAX_ACTIVE_RUNS` | `1` | Load tests that may be queued or running at once (a split group, capacity run or series counts as one). More start requests get **429**. |
| `RECOVER_STALE_RUNS` | `true` | At startup, mark runs left queued/running by a previous process as `interrupted` (skipped in queue mode; the test suite turns it off). |

The container image (`Dockerfile`) runs **gunicorn with one `gthread` worker and
8 threads** as an unprivileged user. One process, because load tests are
background threads of the process that started them (and stop/series state
lives in that process's memory); threads, so status polls are answered while a
slow request is in progress.

Every start request must include `"i_own_target": true` (the UI's "I own this
target or have permission to load-test it" checkbox).

## Command-line runner (`cli.py`)

``` shell
python cli.py run --config loadtest.example.yml              # exit 0 = SLO passed, 1 = failed, 2 = error
python cli.py run --config loadtest.example.yml --users 30 --duration 20
python cli.py run --config loadtest.example.yml --mode capacity --cases valid_sample
```

It talks only to the backend's HTTP API (`--api`, `api:` in the config, or
`ELEVATE_API`; default `http://localhost:5000`) and writes `report-<id>.md`,
`result-<id>.json` and `summary.md` to the output directory. `loadtest.example.yml`
documents every option; `loadtest.ci.yml` is the strict config the GitHub Actions
performance gate uses.

## Tests

``` shell
pip install pytest
python -m pytest
```

356 tests, all without network access or a running server (Locust processes
and HTTP calls are faked). They also pass with plain `pytest`, from `code/` or
from the repository root.

Manual smoke-check scripts, the mock target and the CI regression gate live in
[scripts/](scripts/README.md).

## Layout

- `app.py` — Flask API (analyze, edge cases, load test jobs, cancel, compare, baseline, regressions)
- `analysis/` — URL sanity check, API/website type detection, edge-case generation,
  plus pure helpers: `failure_summary.py` (failures by status code),
  `problem_rate.py` (5xx + 429 + connection failures ÷ requests),
  `case_comparison.py` (per-case comparison across runs: changed at ≥ 10 points,
  cells under 5 requests ignored), `custom_cases.py` (custom case validation),
  `regressions.py` (baseline comparison), `request_headers.py` (header validation
  and redaction), `series_stats.py` (statistics across repeated runs),
  `target_guard.py` (refuses private / metadata targets),
  `outcome_summary.py` (handled correctly vs unexpected answers),
  `slo.py` (SLO thresholds and the PASS / FAIL verdict),
  `capacity.py` (capacity finder: per-step metrics, max sustainable users, breaking point)
- `locust_tests/expectations.py` — decides whether an answer matches a case's
  expected outcome ("accept" = 2xx, "reject" = 4xx); used inside Locust
- `locust_tests/step_shape.py` — step-load shape for capacity runs, combined with a
  user file as `-f dynamic_locustfile.py,step_shape.py`
- `tests/` — pytest unit tests; `conftest.py` puts `code/` on the import path
- `scripts/mock_target.py` — local mock login API for repeatable tests
- `scripts/regression_gate.py` — older CI regression gate against a baseline (exit 0 / 1 / 2)
- `cli.py` — command-line runner with SLO verdict and exit codes; `loadtest.example.yml`,
  `loadtest.ci.yml` — its configs
- `load_test_runner.py` — runs Locust in background threads; splits runs above 50 users
  into `min(10, ceil(users / 50))` child jobs, i.e. parallel Locust processes on the same
  host (merged p95 approximate); stop/cancel; repeat series
- `stats_aggregator.py` — merges child-job stats, failures and per-second history CSVs
  (percentiles as a request-weighted average, i.e. approximate)
- `job_store.py` — SQLite persistence for jobs, job groups and repeat series
- `locust_tests/` — the Locust files for API and website tests
- `worker.py`, `sqs_client.py`, `Dockerfile.worker`, `k8s/worker-deployment.yaml` —
  SQS queue mode (not deployed — future work)
- `frontend/` — React UI
- `k8s/` — deployment manifests; `.gitlab-ci.yml` — CI pipeline
