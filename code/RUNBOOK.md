# Elevate Load Tester — Run Guide

## Two ways to run this: Simple (local) or Queue-based (SQS)

Use **Simple mode** for demos and day-to-day testing — fewer moving parts, nothing to configure.
Use **Queue mode** only when specifically demonstrating the SQS/decoupled architecture.

---

## Simple Mode (recommended default)

**Terminal 1 — Backend:**
cd load_tester
python app.py

**Terminal 2 — Frontend:**
cd load_tester/frontend
npm run dev

Open the printed local URL (usually `http://localhost:5173`). That's it — no environment variables needed. Load tests run as local background threads.

---

## Queue Mode (SQS) — for demonstrating the decoupled architecture

Requires 3 terminals. Same AWS values every time:
AWS_ACCESS_KEY_ID=<your current key>
AWS_SECRET_ACCESS_KEY=<your current secret>
AWS_DEFAULT_REGION=eu-north-1
SQS_QUEUE_URL=https://sqs.eu-north-1.amazonaws.com/974771261352/load-tester-jobs

**Terminal 1 — Backend (with SQS enabled):**
cd load_tester
$env:AWS_ACCESS_KEY_ID="..."
$env:AWS_SECRET_ACCESS_KEY="..."
$env:AWS_DEFAULT_REGION="eu-north-1"
$env:SQS_QUEUE_URL="https://sqs.eu-north-1.amazonaws.com/974771261352/load-tester-jobs"
$env:USE_SQS="true"
python app.py

**Terminal 2 — Worker:**
cd load_tester
$env:AWS_ACCESS_KEY_ID="..."
$env:AWS_SECRET_ACCESS_KEY="..."
$env:AWS_DEFAULT_REGION="eu-north-1"
$env:SQS_QUEUE_URL="https://sqs.eu-north-1.amazonaws.com/974771261352/load-tester-jobs"
python worker.py
Should print: `Worker started. Polling SQS for jobs...`

**Terminal 3 — Frontend (same as Simple Mode):**
cd load_tester/frontend
npm run dev

**IMPORTANT:** In Queue Mode, if you skip setting `USE_SQS=true` in Terminal 1's environment specifically, jobs silently run locally instead of going through SQS — always verify with:
python -c "import os; print(os.environ.get('USE_SQS'))"
before starting `app.py`, if anything seems off.

---

## Quick health check (either mode)
python -c "import requests; print(requests.get('http://localhost:5000/health').json())"
Should return `{'status': 'ok'}`.

---

## Known limitations (be upfront about these if asked)
- SQLite doesn't handle concurrent writes from multiple workers well — fine for one worker (current setup), would need Postgres/DynamoDB for multiple parallel workers
- The worker (`worker.py`) is not yet deployed as a container/K3s pod — `Dockerfile.worker` exists and is ready, but actual deployment is a separate, later phase
- Public test APIs (httpbin, jsonplaceholder) accept malformed input without validation — edge case failures only show meaningful signal against APIs with real validation (e.g. dummyjson.com/auth/login)

---

## Reliable test targets
- **API with real validation:** `https://dummyjson.com/auth/login` — sample input: `{"username": "emilys", "password": "emilyspass"}`
- **Website with sitemap index:** `https://scentitude.in`
- **Website with no sitemap (fallback test):** `https://example.com`