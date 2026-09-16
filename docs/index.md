![Tiet Logo](assets/tiet-logo.svg){ .tiet-logo }

**UCS503: Software Engineering (Project)**  
**TIET Patiala**

# Elevate Load Tester

**Team Elevate** — Yash Bharadwaj, Nikhil Khosla, Krish Agrawal

Elevate Load Tester is a web application for load-testing HTTP targets. It
analyzes a URL, classifies it as an **API** or a **website**, generates
edge-case request payloads (for APIs) or crawls sitemap paths (for websites),
runs an asynchronous Locust-based load test against it, and lets you compare
past runs side by side.

- **Backend:** Flask + Locust, with an SQLite job store
- **Frontend:** React + Vite
- **Deployment:** Docker image deployed to a k3s cluster via GitLab CI

## Workflow

1. **Analyze** — submit a target URL. The backend checks that it is
   well-formed and reachable, then classifies it as an API or a website
   (websites also get a sitemap lookup).
2. **Generate** — for API targets, paste a sample JSON body; the backend
   generates edge-case variations of it (missing fields, wrong types,
   boundary values, etc.).
3. **Select** — tick the edge cases you want to include and confirm the
   selection.
4. **Run** — start the load test with your chosen user count, spawn rate,
   and duration. The test runs asynchronously; the UI polls the job status
   until it completes. Runs above 50 users are split into child jobs and
   their statistics are merged into one aggregated result.
5. **Compare** — pick any two completed runs (including split runs) and
   compare total requests, failures, average response time, and throughput.

Website targets skip steps 2–3: the sitemap paths (or the URL's own path as a
fallback) are load-tested directly.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health`, `/api/health` | Health check — returns `{"status": "ok"}` |
| POST | `/api/sanity-check` | Validate URL format and reachability (`{url}`) |
| POST | `/api/analyze` | Sanity-check + classify a target as API/website; includes sitemap info for websites (`{url}`) |
| POST | `/api/generate-edge-cases` | Generate edge-case payloads from a sample JSON body (`{sample_input}`) |
| POST | `/api/confirm-selection` | Confirm a subset of generated cases (`{sample_input, selected_labels}`) |
| POST | `/api/start-load-test` | Start an async API load test (`{url, confirmed_cases, users, spawn_rate, duration_seconds}`) — returns `job_id` |
| POST | `/api/start-website-load-test` | Start an async website load test (`{url, sitemap_raw?, users, spawn_rate, duration_seconds}`) — returns `job_id` and `paths_used` |
| GET | `/api/load-test-status/<id>` | Poll a job (or split-job group) — completed jobs include Locust stats CSV |
| GET | `/api/jobs` | List past runs: `{jobs, job_groups}` |
| POST | `/api/compare-jobs` | Fetch two runs for comparison (`{job_id_a, job_id_b}`) |

Limits: 1–1000 users, spawn rate 1–20/s, duration 1–300 s.

## Running locally

Backend (Terminal 1):

``` shell
cd code
pip install -r requirements.txt
python app.py        # serves on http://localhost:5000
```

Frontend (Terminal 2):

``` shell
cd code/frontend
npm install
npm run dev          # serves on http://localhost:5173
```

The frontend targets `http://localhost:5000` by default; set `VITE_API_BASE`
in `code/frontend/.env` to point at a different backend (see
`code/frontend/.env.example`).

By default jobs run in-process as background threads. The codebase also
contains an optional SQS queue mode (`worker.py`, `Dockerfile.worker`) for a
decoupled architecture; the SQS worker is **not yet deployed** — see
`code/RUNBOOK.md` for details and known limitations.
