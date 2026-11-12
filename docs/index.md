![Tiet Logo](assets/tiet-logo.svg){ .tiet-logo }

**UCS503: Software Engineering (Project)**  
**TIET Patiala**

# Elevate Load Tester

**Team Elevate** — Anant Agrawal, Piyush Singh, Vivek Pandey

Elevate Load Tester is a web application for load-testing HTTP targets. It
analyzes a URL, classifies it as an **API** or a **website**, generates
edge-case request payloads (for APIs) or crawls sitemap paths (for websites),
runs an asynchronous Locust-based load test against it, and lets you compare
past runs side by side.

- **Backend:** Flask + Locust, with an SQLite job store
- **Frontend:** React + Vite
- **Deployment:** Docker image deployed to a k3s cluster via GitLab CI

## Features

- API/website classification of a target URL
- Generated edge cases plus validated custom cases
- Asynchronous load tests; runs above 50 users run as parallel Locust processes on
  the same host and are merged (merged p95 is approximate)
- Results: failure rate, average and p95 response time, per-case table
  (sortable, flat or grouped by category), failures grouped by type
- Timeline charts (users, throughput, response time per second)
- Comparison of 2–4 runs with a per-case "Changed with load" table
- Baseline runs with regression flags, and a downloadable Markdown report
- A local mock login API for repeatable offline testing (optionally
  requiring a bearer token)
- Problem rate (5xx, 429, connection failures) next to the failure rate
- Stop a running test, keeping partial results
- Retry banner when the backend connection is lost during a run
- Request headers for authenticated APIs; values are never stored
- A CI regression gate script (exit code 0 / 1 / 2) with a manual GitLab job
- Repeated runs (1–5) with mean ± standard deviation across repeats
- Target guardrails: private and cloud-metadata targets refused, an "I own this
  target" confirmation on every load test, CORS restricted, gunicorn as non-root
- Expected outcomes per edge case: "handled correctly" vs accepted invalid input
  (validation bugs) and rejected valid input
- SLO thresholds with a PASS / FAIL verdict (results, history, comparison, report)
- Capacity finder: step load until the SLO breaks; max sustainable users and the
  breaking point
- Command-line runner (`cli.py`) and a GitHub Actions pipeline with a performance gate
- One-command demo: `docker compose up --build`, then http://localhost:8080

Every feature is explained in plain English, with demo steps, in
[Features explained](features.md). How we know the product works — the measured
results, test counts and the CI gate — is in [Evaluation](evaluation.md).

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
   until it completes. Runs above 50 users run as several Locust processes in
   parallel on the same host; their statistics are merged into one result
   (the merged p95 is an approximation).
5. **Compare** — tick 2 to 4 completed runs (including split runs) to compare
   their totals side by side and see, case by case, which edge cases changed
   with load. Any run can also be marked as the baseline for its target, so
   later runs are checked for regressions automatically.

Website targets skip steps 2–3: the sitemap paths (or the URL's own path as a
fallback) are load-tested directly.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health`, `/api/health` | Health check — returns `{"status": "ok"}` |
| POST | `/api/sanity-check` | Validate URL format and reachability (`{url}`); 400 `{blocked_target: true}` for a refused address |
| POST | `/api/analyze` | Sanity-check (read-only HEAD → GET → OPTIONS; a 404/405 answer = reachable, `method_not_allowed`) + classify a target as API/website; includes sitemap info for websites (`{url, headers?}`); 400 `{blocked_target: true}` for private/metadata targets (redirect hops are checked too) |
| POST | `/api/generate-edge-cases` | Generate edge-case payloads from a sample JSON body (`{sample_input}`); every case has `expect` ("accept" / "reject"); the first is the sample itself |
| POST | `/api/validate-custom-case` | Check a user-written case against the sample (`{sample_input, label, payload}`) |
| POST | `/api/confirm-selection` | Confirm a subset of generated cases, plus optional custom cases (`{sample_input, selected_labels, custom_cases?, expectations?}`); custom cases may set `expect` (default "reject"); `expectations` overrides generated ones by label |
| POST | `/api/start-load-test` | Start an async API load test (`{url, confirmed_cases, users, spawn_rate, duration_seconds, i_own_target: true, headers?, repeat?, slo?, mode?, capacity?}`) — returns `job_id`; with `repeat` > 1 it is a series id. Without `i_own_target: true` → 400. `slo`: optional thresholds `{p95_ms, avg_ms, max_server_error_rate_pct, max_unexpected_outcome_rate_pct, min_rps}`. **429** `{busy: true, active_runs, max_active_runs}` when `MAX_ACTIVE_RUNS` (default 1) runs are already queued or running (both start endpoints). `mode: "capacity"` + `capacity: {start_users, step_users, step_duration_seconds, max_users, early_stop?}` runs a step-load capacity search (one job, needs an SLO; 409 in SQS mode) |
| POST | `/api/start-website-load-test` | Start an async website load test (`{url, sitemap_raw?, users, spawn_rate, duration_seconds, i_own_target: true, headers?, repeat?, slo?, mode?, capacity?}`) — returns `job_id` and `paths_used` |
| GET | `/api/load-test-status/<id>` | Poll a job, split-job group or repeat series (status: queued, running, completed, failed, timeout, cancelled or interrupted) — completed runs include the Locust stats, failures and per-second history CSVs, plus `failure_summary`, `problem_rate`, `header_names`, `case_expectations`, `outcome_summary` (handled correctly / unexpected answers), `slo` and, once completed, `slo_verdict` (PASS / FAIL with one check per threshold); capacity runs have `mode: "capacity"`, `capacity_plan` and `capacity` (steps, max sustainable users, breaking point, headline); a series includes `runs` and `series_summary` |
| POST | `/api/cancel/<id>` | Stop a running job, group or series (202; 409 in SQS queue mode, which is not deployed) |
| GET | `/api/jobs` | List past runs: `{jobs, job_groups}`; each row has `slo` and `slo_verdict` ("PASS" / "FAIL" / null) |
| POST | `/api/compare-jobs` | Compare 2–4 runs (`{job_ids}` → `{jobs, case_comparison}`); the original `{job_id_a, job_id_b}` form still works |
| POST | `/api/baseline` | Mark a completed run as the baseline for its target (`{id}`) |
| GET | `/api/baseline?target_url=…` | Get the baseline run id for a target |
| GET | `/api/regressions/<id>` | Compare a run with its target's baseline (or with `?baseline_id=<id>`) |

Limits: 1–1000 users, spawn rate 1–20/s, duration 1–300 s.

## Running locally

The quickest way is `docker compose up --build` at the repository root, then
http://localhost:8080 (see `code/RUNBOOK.md`). To run from source:

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

For a repeatable, offline target, start the mock login API in a third
terminal (`cd code`, then `python scripts/mock_target.py`) and analyze
`http://127.0.0.1:8000/api/login` — see `code/scripts/README.md`.

The frontend targets `http://localhost:5000` by default; set `VITE_API_BASE`
in `code/frontend/.env` to point at a different backend (see
`code/frontend/.env.example`).

Jobs run in-process as background threads. The codebase also contains an SQS
queue mode (`worker.py`, `Dockerfile.worker`) for a decoupled architecture; it
is **not deployed — future work** — see
`code/RUNBOOK.md` for details and known limitations.
