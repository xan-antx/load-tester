# Elevate Load Tester — Run Guide

All paths below are relative to the repository root. The application lives in `code/`.

## Ways to run this

- **Docker compose** — one command, everything in containers (app, backend, mock target). Best for demos.
- **Simple mode** — backend and frontend from source; fewer moving parts, nothing to configure.
- **Queue mode** — **not deployed; future work.** Only for demonstrating the SQS/decoupled architecture locally.
- **CLI** — one load test from a config file, with a pass/fail exit code (for CI).

---

## Docker compose (one command)

From the repository root (Docker Desktop or Docker Engine with compose v2):
```
docker compose up --build
```
Then open `http://localhost:8080`. The app opens already filled in for the mock target
(`http://mock:8000/api/login` with the demo sample): click **Analyze**, then
**Generate edge cases**, tick the ownership box and start a run.

What runs:

| Service | What it is | Port on the host |
|---|---|---|
| `frontend` | nginx serving the built app; proxies `/api` to the backend | 8080 |
| `backend` | the Flask API under gunicorn (same image as production), SQLite in a named volume | 5000 (optional, for the CLI) |
| `mock` | `scripts/mock_target.py`, listening on `0.0.0.0` inside the network | 8000 (optional) |

Inside compose the mock target is reached by its service name, `http://mock:8000`, which
resolves to a private address, so the backend runs with `ALLOW_PRIVATE_TARGETS=true`.
(Do not set that on a public deployment.) Stop everything with `docker compose down`
(add `-v` to also delete the stored runs).

---

## Simple Mode (recommended default)

**Terminal 1 — Backend:**
```
cd code
pip install -r requirements.txt
python app.py
```

**Terminal 2 — Frontend:**
```
cd code/frontend
npm install
npm run dev
```

Open the printed local URL (usually `http://localhost:5173`). That's it — no environment variables needed. Load tests run as local background threads.

For a repeatable offline target, start the mock login API in a third terminal
(`cd code`, then `python scripts/mock_target.py`) — see [scripts/README.md](scripts/README.md).

---

## Queue Mode (SQS) — not deployed, future work

The deployed backend runs load tests in-process (`USE_SQS=false`). Queue mode below works
locally for demonstrating the decoupled architecture, but no worker is deployed.

Requires 3 terminals. Same AWS values every time:
```
AWS_ACCESS_KEY_ID=<your current key>
AWS_SECRET_ACCESS_KEY=<your current secret>
AWS_DEFAULT_REGION=eu-north-1
SQS_QUEUE_URL=https://sqs.eu-north-1.amazonaws.com/<AWS_ACCOUNT_ID>/load-tester-jobs
```

(The real queue URL contains our AWS account ID — don't commit it. Keep it in the
`SQS_QUEUE_URL` environment variable / a local untracked `.env`.)

**Terminal 1 — Backend (with SQS enabled):**

PowerShell:
```
cd code
$env:AWS_ACCESS_KEY_ID="..."
$env:AWS_SECRET_ACCESS_KEY="..."
$env:AWS_DEFAULT_REGION="eu-north-1"
$env:SQS_QUEUE_URL="https://sqs.eu-north-1.amazonaws.com/<AWS_ACCOUNT_ID>/load-tester-jobs"
$env:USE_SQS="true"
python app.py
```

bash:
```
cd code
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_DEFAULT_REGION="eu-north-1"
export SQS_QUEUE_URL="https://sqs.eu-north-1.amazonaws.com/<AWS_ACCOUNT_ID>/load-tester-jobs"
export USE_SQS="true"
python app.py
```

**Terminal 2 — Worker:**

PowerShell:
```
cd code
$env:AWS_ACCESS_KEY_ID="..."
$env:AWS_SECRET_ACCESS_KEY="..."
$env:AWS_DEFAULT_REGION="eu-north-1"
$env:SQS_QUEUE_URL="https://sqs.eu-north-1.amazonaws.com/<AWS_ACCOUNT_ID>/load-tester-jobs"
python worker.py
```

bash:
```
cd code
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_DEFAULT_REGION="eu-north-1"
export SQS_QUEUE_URL="https://sqs.eu-north-1.amazonaws.com/<AWS_ACCOUNT_ID>/load-tester-jobs"
python worker.py
```

Should print: `Worker started. Polling SQS for jobs...`

**Terminal 3 — Frontend (same as Simple Mode):**
```
cd code/frontend
npm run dev
```

**IMPORTANT:** In Queue Mode, if you skip setting `USE_SQS=true` in Terminal 1's environment specifically, jobs silently run locally instead of going through SQS — always verify with:
```
python -c "import os; print(os.environ.get('USE_SQS'))"
```
before starting `app.py`, if anything seems off.

In queue mode, stopping a running test (`/api/cancel`) and request headers are
refused with HTTP 409: the worker runs elsewhere, and the queue message would
carry the header values.

---

## Quick health check (either mode)
```
python -c "import requests; print(requests.get('http://localhost:5000/health').json())"
```
Should return `{'status': 'ok'}`.

---

## CLI (pass / fail for CI)

With a backend running (simple mode or compose), from `code/`:
```
python cli.py run --config loadtest.example.yml
python cli.py run --config loadtest.example.yml --users 30 --duration 20
python cli.py run --config loadtest.example.yml --mode capacity --cases valid_sample
```
Exit codes: **0** SLO passed, **1** SLO failed, **2** error. The report, the JSON result and
`summary.md` go to `loadtest-results/` (or `output.dir` / `--out-dir`). Against the compose
stack, point the target at the mock's service name:
`--api http://localhost:5000 --url http://mock:8000/api/login`.

`loadtest.ci.yml` is the strict config the GitHub Actions performance gate runs.

---

## Tests
```
cd code
pip install pytest
python -m pytest
```
356 tests, no network and no running server needed. CI runs them on every push and pull
request (`.github/workflows/ci.yml`), together with frontend lint and build, the
performance gate and, on `main`, the Docker image build.

---

## Known limitations (be upfront about these if asked)
- SQLite doesn't handle concurrent writes from multiple workers well — fine for one worker (current setup), would need Postgres/DynamoDB for multiple parallel workers
- The worker (`worker.py`) is not yet deployed as a container/K3s pod — `Dockerfile.worker` and `k8s/worker-deployment.yaml` exist and are ready, but the CI pipeline does not apply them; the deployed backend runs with `USE_SQS=false` (jobs run in-process)
- Merged p95 for split runs (above 50 users) is a request-weighted average of each child job's p95, not a true percentile; the UI marks it with ≈
- Only load-test targets you own or have permission for; every start request needs `i_own_target: true`
- Public test APIs (httpbin, jsonplaceholder) accept malformed input without validation — edge case failures only show meaningful signal against APIs with real validation (e.g. dummyjson.com/auth/login, or the local mock target)

---

## Reliable test targets
- **Local mock API (offline, repeatable):** `http://127.0.0.1:8000/api/login` (run `python scripts/mock_target.py` in `code/`) — sample input: `{"username": "demo", "password": "demo123", "expiresInMins": 30}`
- **API with real validation:** `https://dummyjson.com/auth/login` — sample input: `{"username": "emilys", "password": "emilyspass"}`
- **Mock target inside docker compose:** `http://mock:8000/api/login` (same sample)
- **Website with no sitemap (fallback test):** `https://example.com` — only with a few users; it is not ours
