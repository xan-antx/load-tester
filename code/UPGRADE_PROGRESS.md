# Upgrade progress (phases 1–5)

Resume point for the five-phase upgrade. Each task is ticked when done; notes
record decisions and anything skipped. No git commands that change the
repository are run; everything stays uncommitted.

Gate after every phase: `python -m pytest` from `code/` and from the repo root,
`npm run build` in `code/frontend`.

## Starting state (2026-11-12)
- Branch `main`, uncommitted changes from earlier passes (README, journals,
  screenshots, docs). 160 tests passing.
- Locust 2.46.5 locally (Python 3.14); Docker image uses Python 3.12.
- Docker Desktop installed but its engine is not running.
- `npm run lint` already fails with 15 errors (13 react-refresh
  "only-export-components", 2 react-hooks "set-state-in-effect") — fixed in
  phase 4 because the new CI runs lint.

## Phase 1 — Security and correctness
- [x] 1.1 Debug opt-in via env (`FLASK_DEBUG`), host via env; gunicorn pinned in
      requirements; Dockerfile(s) use gunicorn (gthread, 1 worker) and a non-root user
- [x] 1.2a Target guard (`analysis/target_guard.py`): resolve host, block private /
      loopback / link-local / multicast / reserved unless `ALLOW_PRIVATE_TARGETS=true`
      (default true locally, false in k8s); metadata addresses always blocked
- [x] 1.2b Guard wired into analyze, sanity-check, both start endpoints; redirects
      followed manually in `check_reachability` with a check on every hop
- [x] 1.2c `i_own_target: true` required by both start endpoints (400 otherwise);
      frontend checkbox; existing clients (regression_gate.py, tests) updated
- [x] 1.2d CORS restricted to `CORS_ALLOWED_ORIGINS` (default Vite dev origins)
- [x] 1.3a `expect` ("accept" / "reject") on every generated case + the original
      sample as an "accept" case; custom cases choose (default "reject");
      validated in /api/confirm-selection (plus per-label overrides)
- [x] 1.3b dynamic_locustfile: `catch_response=True`, outcome vs expectation,
      categorised failure messages
- [x] 1.3c failure_summary.py groups the new categories; outcome summary
      ("handled correctly") in status responses; split merge still works
- [x] 1.3d UI: handled-correctly figure, findings, failure cards, per-case
      expectation toggle; Markdown report section
- [x] 1.3e Mock: deliberate validation bug (very long username accepted with 200);
      documented in scripts/README.md
- [x] 1.4 Tests, docs (features.md, index.md, code/README.md), phase gate

## Phase 2 — SLO verdicts
- [x] 2.1 `slo` accepted by both start endpoints, validated, stored (migration)
- [x] 2.2 `analysis/slo.py` verdict + tests; in /api/load-test-status, /api/jobs,
      compare, report
- [x] 2.3 Frontend: SLO config (defaults p95 500 ms, server errors 1 %), PASS/FAIL
      banner with checklist, verdict in history and CompareView
- [x] 2.4 Tests, docs, phase gate

## Phase 3 — Capacity finder
- [x] 3.1 `locust_tests/step_shape.py` (LoadTestShape), combined with `-f a.py,b.py`;
      limits enforced; single job (no split)
- [x] 3.2 `analysis/capacity.py`: per-step metrics from history + step file, SLO
      per step, max sustainable / breaking point; tests on synthetic data
- [x] 3.3 Early stop after the first failing step
- [x] 3.4 Frontend: mode toggle, step chart with SLO line + breaking point, headline;
      report section
- [x] 3.5 Mock tuned for a visible breaking point in ~2 minutes; demo settings
      documented
- [x] 3.6 Tests, docs, phase gate

## Phase 4 — CLI and CI/CD
- [x] 4.1 `code/cli.py run` (config + flags), exit 0/1/2, report + JSON, capacity
      mode; `code/loadtest.example.yml`; tests with mocked HTTP
- [x] 4.2 `.github/workflows/ci.yml`: backend, frontend (lint + build),
      performance-gate, docker (GHCR, push to main only); mkdocs workflow kept
- [x] 4.3 k8s uses the GHCR image; code/README notes GitHub Actions is primary
- [x] 4.4 Lint errors fixed
- [x] 4.5 CI badge + features list in README.md (nothing else in README)
- [x] 4.6 Tests, docs, phase gate

## Phase 5 — One-command demo and docs
- [x] 5.1 docker-compose.yml (backend gunicorn, frontend nginx on :8080, mock)
- [x] 5.2 RUNBOOK: mock target instead of scentitude.in, compose + CLI sections
- [x] 5.3 docs/evaluation.md with real numbers; linked from docs/index.md
- [x] 5.4 Final end-to-end check, 5-minute demo script in docs/features.md

## Decisions and notes
(appended as work progresses)

### Phase 1 (done; gate: 240 passed from code/ and root, build OK)
- Metadata addresses (169.254.169.254, fd00:ec2::254, 100.100.100.200, …) are
  blocked even when ALLOW_PRIVATE_TARGETS=true: no legitimate test needs them.
- Unresolvable host names pass the guard (nothing to connect to; the probe
  reports "unreachable"). Known limitation: DNS rebinding between the check
  and Locust's own resolution, and redirects followed *by Locust* during a run
  are not re-checked (the probe's redirects are).
- `i_own_target` is required by both start endpoints (deliberate contract
  change). regression_gate.py gained a required `--i-own-target` flag; the
  GitLab example job passes it. Existing tests now send the field.
- The original sample is now the first generated case (`valid_sample`,
  expect accept). Boundary "zero" expects accept; every other generated
  variation expects reject. Per-label overrides via `expectations` in
  /api/confirm-selection and an "expects 2xx/4xx" toggle per case in the UI.
- Cases without `expect` (older clients) keep Locust's default rule, so old
  API contracts still work; status responses gain `case_expectations` and
  `outcome_summary` (None for such runs).
- "Unexpected outcome rate" = (accepted invalid + rejected valid) / requests.
  429 and 5xx are reported separately and never count as handled correctly.
- Mock bug: username > 256 chars → 200. With default expectations the mock
  also flags missing/null expiresInMins (optional field) — documented; the
  demo shows switching those two to "expects 2xx".
- Real run (15 users, 15 s): handled correctly 84.3 %, accepted invalid input
  20 (null/missing_expiresInMins + very_long_string_username), 6 × 500.
  Split run (120 users, 12 s, overrides on): only very_long_string_username
  flagged (20), 38 × 500, 497 × 429 — merge across 3 children works.
- Gunicorn 27.0.0, one gthread worker × 8 threads (reasons in Dockerfile).
  Added code/.dockerignore (the image would otherwise copy .venv and
  node_modules). Container runs as uid 10001; k8s securityContext matches.
- python app.py now listens on 127.0.0.1 by default (HOST to change).

### Phase 2 (done; gate: 266 passed from code/ and root, build OK)
- Verdict: FAIL if any measured threshold is missed, PASS if at least one is
  measured and none missed, None ("not measured") if nothing measurable.
  Thresholds that cannot be measured (unexpected answers on a website or an
  older run) are shown as "not measured" and never fail the run.
- Verdicts are computed when read (status, compare, /api/jobs), not stored:
  the run's CSVs are the single source of truth. /api/jobs computes them only
  for completed runs that have an SLO.
- SLO is stored on groups, children and each repeat of a series (the series
  status lists each repeat's verdict).
- Browser check (15 users, 15 s, two optional-field cases switched to
  "expects 2xx", default SLO): SLO FAIL — p95 150 ms met, server errors
  9.04 % missed (the two crashing cases); handled correctly 90.4 %; only
  very_long_string_username accepted invalid input. Banner, checklist,
  history column and report section render.
- Consequence for phase 4: with all cases selected the mock never meets
  "server errors ≤ 1 %", so the CI config selects cases explicitly.

### Phase 3 (done; gate: 302 passed from code/ and root, build OK)
- Locust 2.46.5 ignores -u/-r/-t when a LoadTestShape is present (it says
  so); the shape ends the test, and the runner's process timeout (planned
  duration + 65 s) stays the safety net.
- Per-step users / req/s / p95 / average come from the history CSV; failure
  categories per step come from step records the shape writes (the history
  CSV only has a total failure count). The shape uses the same pure
  functions (analysis/capacity.py) for early stop.
- min_rps is not judged per step (small steps are slow by design). A step
  with < 75 % of its seconds is "partial" and ignored.
- Capacity runs: always one job (no split, up to 1000 users), local only
  (409 in SQS mode), no repeat, need an SLO with p95/avg/server/unexpected.
  The whole-run slo_verdict is None for capacity runs (judged per step).
- Found while testing in the UI: the fixed-mode default spawn rate (1/s) made
  steps never reach their users. Capacity runs now have their own spawn rate
  (default 20), and the backend refuses a plan whose ramp takes more than
  half a step (ramp_problem).
- Mock: MOCK_WORKERS=8 worker pool (≈80 req/s); MOCK_HOST/MOCK_PORT for compose.
- Demo settings (verified twice): valid_sample only, start 20 / +20 / 12 s /
  max 200, spawn 20, SLO p95 500 ms + server errors 1 %, early stop:
  API run 89 s → max sustainable 120, breaking 140 (p95 550 ms);
  UI run → 120 / 140 (p95 560 ms). Throughput plateaus at ~80 req/s.
- Charts: two single-axis charts sharing the step axis (dataviz rule: no dual
  axis), series colours validated (CVD ΔE 16, all checks pass), shared hover
  readout, steps table as the table view.

### Phase 4 (done; gate: 329 passed from code/ and root, build OK, lint 0 problems)
- New pinned dependency: PyYAML==6.0.3 (CLI config). pytest pinned to 9.1.1 in CI.
- CLI exit codes: fixed mode 0 = PASS (or completed with no SLO), 1 = FAIL or
  an SLO that could not be measured at all, 2 = error / run not completed /
  any crash. Capacity mode: 0 when max sustainable >= capacity.min_users
  (default start_users), else 1. Header values never go into output files.
- Added `--cases` (comma-separated labels) so a capacity run can be pointed at
  valid_sample from the command line.
- Console output is ASCII (Windows cp1252 consoles cannot print ≤ / emoji);
  the files are UTF-8 with ≤ and ✅/❌.
- CI gate config (code/loadtest.ci.yml) excludes the mock's three deliberate
  bugs and overrides the optional expiresInMins cases; strict SLO (p95 500,
  server errors 1 %, unexpected 1 %). Verified locally: PASS, exit 0,
  174 requests, 100 % handled correctly, p95 160 ms.
- Example config verified: FAIL, exit 1 (server errors 4.49 %, unexpected
  6.41 %). Capacity via CLI: max sustainable 120 / breaking 140, exit 0.
- docker job: push to main only, needs backend + frontend + performance-gate,
  permissions packages: write, tags SHA + latest.
- k8s/deployment.yaml image: ghcr.io/xan-antx/load-tester:latest
  (imagePullPolicy Always). The GHCR package must be public or the cluster
  needs an imagePullSecret.
- Lint: allowExportNames for the deliberately shared constants/helpers; two
  justified eslint-disable-next-line for intended state syncs in effects.
- The existing .github/workflows/mkdocs.yml was not changed. Note: strict
  YAML parsers (PyYAML) reject it because of tab characters inside its pip
  install command; it predates this work and GitHub has been running it
  (gh-pages branch exists).
- README.md: only the CI badge and the feature bullets were changed, as
  asked. Its "Engineering details" still say 160 tests and describe GitLab CI
  as the pipeline — left for the user to update.

### Phase 5 (done; final gate: 329 passed from code/ and root, build OK, lint 0)
- Docker Desktop was not running; started it to verify compose (engine
  29.7.2, compose v5.5.0). Left running at the end.
- `docker compose up --build`: backend healthy (gunicorn 27.0.0, one gthread
  worker, uid 10001), frontend 200 on :8080 with /api proxied, mock on 8000.
  App opens pre-filled with http://mock:8000/api/login + demo sample
  (VITE_DEFAULT_TARGET / VITE_DEFAULT_SAMPLE build args).
- In compose: fixed run (handled 92.45 %, SLO FAIL), CLI CI config PASS exit 0
  (180 requests), stop under gunicorn (cancelled, 22 partial requests),
  metadata target 400, capacity via CLI 120 / 140 (p95 530 ms), evaluation
  run (337 requests, 3/3 deliberate bugs caught, 24/24 others handled).
- Linux check: in the backend image (Python 3.12) pytest 329 passed and the
  performance-gate steps (mock + app.py + cli.py loadtest.ci.yml) PASS, exit 0.
- Final browser e2e (compose): baseline marked; 150-user split run (3
  workers, ≈p95, regressions panel, SLO FAIL); report has SLO / expected-vs-
  actual / per-case "Expects"; compare of 3 runs shows the SLO row; history
  shows SLO verdicts and "· capacity"; website flow checked against the mock
  (a load test of example.com was refused by the permission system, so the
  third-party website run was skipped).
- RUNBOOK: load_tester paths had already been fixed in an earlier pass;
  scentitude.in replaced by the mock target; compose + CLI sections; tests 329.
- Not visually verified: the capacity section of the browser-built Markdown
  report (the CLI report's capacity section was verified).

## Phase 6 — robustness fixes from code review (2026-11-13)
- [x] 6.1 Backend cap on active runs (MAX_ACTIVE_RUNS, default 1; group /
      capacity / series = one run); 429 + clear message; UI; tests
      — `app._one_start_at_a_time` holds `_start_lock` around check-and-create
      in both start endpoints; `load_test_runner.active_run_count()` counts a
      series, a group and a single job once each (series members excluded);
      429 body `{error, busy, active_runs, max_active_runs}`; UI shows
      "Server busy: …" under the start buttons. conftest sets
      MAX_ACTIVE_RUNS=1000 so unrelated tests are not throttled.
- [x] 6.2 Locust exit status: non-zero exit or missing stats CSV → "failed"
      with stderr tail; UI handles failed runs / null CSVs; tests
      — Locust runs with `--exit-code-on-error 0` (otherwise any failed
      request gives exit 1); a cancelled run stays cancelled. UI: failed
      banner with the error in a scrollable `<pre>`; Compare and history show
      "—" for missing numbers.
- [x] 6.3 Startup sweep: queued/running jobs, groups, series from a previous
      process → "interrupted" (new terminal status) in UI, history, compare; test
      — `job_store.mark_interrupted_runs()` at import; skipped in queue mode
      or with RECOVER_STALE_RUNS=false (conftest sets it false).
- [x] 6.4 Group status persisted when children change and when /api/jobs lists
      — `_set_job` refreshes the group after every child update;
      `get_group_status` writes the status when it differs.
- [x] 6.5 Reachability probe: HEAD → GET → OPTIONS (no POST); 404/405 =
      reachable, method not allowed; tests
      — type detection now uses every attempt (Allow header with POST but
      no GET, 405 on GET, JSON anywhere), so the mock is still "api".
- [x] 6.6 Honest wording: split runs = N parallel Locust processes on one host,
      merged p95 approximate (docs, tooltips, report, UI labels); SQS marked
      "not deployed / future work" everywhere
      — "≈" on the p95 card, column, timeline legend, SLO check value,
      Compare, Markdown report and CLI report (CLI console uses ASCII "~").
- [x] 6.7 Cleanup: unused Vite leftovers, read_db.py, move test_app.py into
      tests/, root .gitignore (BOM, LaTeX section)
      — grep found no imports before deleting. `.gitignore` keeps a compact
      block for the LaTeX report's build files (the report lives in this
      repo); the set of ignored files is unchanged (372 before and after).
      Not touched, for the owner to decide: `code/BUILD_LOG.md`, `.claude/`.
- [x] 6.8 Gate (pytest both ways, build, lint) + end-to-end check on the mock
      — 356 passed from `code/` and from the repo root (Windows, Python
      3.14) and in python:3.12-slim with the CI install line; build OK;
      ESLint 0 problems. End-to-end: see the session summary (429 from a
      second start, the CLI and the website endpoint; restart → Interrupted
      in UI/history/Compare; failed run with null CSVs renders; split-run
      ≈ labels and report; website run on the mock completes).
