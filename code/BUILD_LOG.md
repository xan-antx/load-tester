# Build log — feature tiers 0–4

Running log kept while building. For each tier: what was built, how it was
verified (**browser** = seen in the running UI; **API/script** = checked by
calling the backend or reading data, not visually), items skipped, and
things to check by hand. No git commands were run at any point.

Test commands used throughout (all four must pass):
`python -m pytest` and `pytest`, each from `code/` and from the repo root.
Also simulated GitLab's layout (a copy of `code/` with no parent pyproject)
with plain `pytest`.

---

## Tier 0 — Local mock target

**Built**
- `scripts/mock_target.py` — standalone Flask login API on 127.0.0.1:8000
  (`POST /api/login`): 400 for bad/missing credentials, deliberate 500 for an
  unvalidated `expiresInMins`, global rate limit (default 40 req/s,
  `MOCK_RATE_LIMIT`) returning 429, 50–150 ms random latency.
- `scripts/README.md` — how to run it, valid credentials (demo / demo123),
  table of deliberate behaviours.

**Verified (API/script)**
- 14 single-request rule checks, all correct; a burst of 80 concurrent
  requests got exactly 40 × 200 and 40 × 429.
- Through the app's API (same calls the frontend makes), 26 cases, 10 s:
  15 users → 400s and 500s only, 0 × 429; 150 users (split into 3 child jobs)
  → 330 × 400, 26 × 500, 553 × 429.

**Check by hand**
- With the default limit of 40, tolerated `expiresInMins` cases fail roughly
  35–60% at 150 users (all 429s) — more than dummyjson's ~22–30%. Kept at 40
  as decided.

**Found (pre-existing bug, fixed in Tier 1)**: merged split-run stats had two
"Aggregated" rows; the second was double-counted.

---

## Tier 1 — Readable results

**Built**
- Bug fix: `stats_aggregator.merge_stats_csvs()` skips each child's own
  "Aggregated" row, so a merged run has exactly one, with correct totals.
  `merge_failures_csvs()` needed no change (Locust's failures file has no
  Aggregated row). Older groups already stored in the database still contain
  the duplicate; the UI reads the first (correct) row, so they display fine.
- `conftest.py` in `code/` so plain `pytest` can import project modules from
  `code/tests/`.
- 1.1 `analysis/failure_summary.py` → `summarize_failures()`: quote-aware CSV
  parse, extracts status code + reason, groups by code (4xx → Rejected,
  429 → Rate limited, 5xx → Server error, no code → Connection failure).
  Added as `failure_summary` on the job status, group status and both runs of
  the compare response (additive). Frontend: one card per failure type with a
  coloured code badge (400 amber, 429 blue, 500 red, connection grey),
  meaning, total and case chips; header now "N failure types"; the old raw
  per-error list is behind "Show raw errors".
- 1.2 p95: "p95 Response" stat card and p95 column. Split runs show "≈" with a
  tooltip explaining the merged percentile is a request-weighted average.
- 1.3 `utils/formatTime.js`: UTC → local display in the run dropdowns. Sorting
  still uses the raw `created_at`.
- 1.4 Website mode: first column "Page", Flat/Grouped toggle hidden (table
  forced flat). **Signal used:** `job_type === "website"` when present (split
  groups store it), otherwise "every row name starts with /" — page paths
  always start with "/", edge-case labels never do. (The category chips live
  in section 3, which only appears for API targets, so they are already
  hidden for websites.)

**Tests**: `tests/test_stats_aggregator.py` (3-child merge → one Aggregated
row with correct totals, weighted averages, failures merge),
`tests/test_failure_summary.py` (real Locust strings, quoted commas, non-HTTP
errors, empty input). 13 passed, all four ways + CI simulation.

**Verified**
- API/script: 150-user mock run → exactly 1 Aggregated row; failure_summary
  totals (597 + 319 + 40) equal the merged failure count (956).
- Browser (150-user mock run started from the UI; users/spawn set through the
  console because number-input clicks are unreliable in this pane):
  saw p95 card "≈317 ms / approx. (split run)", "≈" in the p95 column,
  "Split across 3 workers", "3 failure types" with blue 429 / amber 400 /
  red 500 cards whose totals (603 + 325 + 29) equal the 957 failures on the
  Failure Rate card, and "Show raw errors (49)".
- Browser: run dropdown shows local time (e.g. "10/8/2026, 10:38:37 PM"),
  option values are still run ids.
- Browser: website run on https://example.com (2 users, 5 s) → header "Page",
  no Flat/Grouped toggle, p95 without "≈".
- `npm run build` clean.

**Check by hand**: hover the "≈" values to read the tooltip.

---

## Tier 2 — Comparison that shows the real story

**Built**
- 2.1 `/api/compare-jobs` also accepts `{"job_ids": [...]}` (2–4 job or group
  ids) and returns `{"jobs": [...], "case_comparison": {...}}` in the same
  order, each run with `failure_summary`. Bad lists → 400, unknown id → 404.
  The original `job_id_a`/`job_id_b` → `job_a`/`job_b` form is unchanged.
  Frontend: the two dropdowns became a checklist of past runs (same merged,
  normalized, sorted `jobHistory`, keyed on `j.id`); 2–4 selections, tick
  order shown as #1–#4, a 5th tick is disabled, message when fewer than 2.
  The metric table has one column per run (failure rate and p95 rows
  included); every run after the first shows ▲/▼ % vs Run 1 with the same
  semantic colours as before (throughput up = green; failures, failure rate,
  latency up = red; duration neutral).
- 2.2 `analysis/case_comparison.py` → `compare_cases()` (backend, so it is
  unit-tested): one row per case across the selected runs; each cell has
  failure %, request count, and a low-sample flag (< 5 requests). A row is
  "changed" if the failure rate differs by ≥ 10 percentage points between any
  two runs, counting only cells with ≥ 5 requests; changed rows sorted first.
  Frontend: "Per-case failure rate" table with a legend, "Changed with load"
  section highlighted, low-sample cells faded and labelled.

**Tests**: `tests/test_case_comparison.py` (8 tests: change detection, 100%
everywhere not changed, low-sample ignored, sorting, inclusive threshold,
missing cases, empty input) and `tests/test_compare_endpoint.py` (new form
order + case_comparison, bad lists → 400, unknown → 404, old form unchanged)
using a temporary database. 28 passed, all four ways.

**Verified**
- API/script: three 30 s mock runs (15 / 50 / 150 users). 15u vs 150u and
  15/50/150: "changed" = exactly `zero_`, `null_`, `missing_expiresInMins`
  (0% → ~60%); credential cases 100% in every run and not changed.
- Browser: ticked the three runs (via console clicks on the checkboxes),
  saw #1/#2/#3 order, per-run columns with ▲/▼ deltas in the right colours,
  "Changed with load (3)" highlighted with Δ points, 23 unchanged rows.
- Browser: compared an old 10 s 15-user run (≈3 requests per case) with the
  150u run → 19 cells faded "low sample", "Changed with load (0)".

**Check by hand**
- For the demo comparison, make the low-load run at least 30 s long; with
  10 s at 15 users almost every case is a low sample and nothing is flagged.
- `jobHistory` is capped at the 50 newest jobs + 50 newest groups by the
  existing `/api/jobs` endpoint (unchanged).

---

## Tier 3 — Timeline and custom edge cases

**Built**
- 3.1 Timeline. `_run_locust()` also stores Locust's
  `<prefix>_stats_history.csv` as `history_csv` (new jobs column);
  `get_group_status()` merges the children's histories into
  `aggregated_history_csv` (new job_groups column), both added with the
  defensive ALTER pattern. `stats_aggregator.merge_history_csvs()`: only
  "Aggregated" rows, grouped by whole-second Timestamp; User Count,
  Requests/s, Failures/s summed; response time and p95 averaged weighted by
  Requests/s (plain average if a second has 0 req/s); output uses Locust's
  own column names so single and merged histories are read the same way.
  Frontend `components/Timeline.jsx`: inline SVG, shared time axis, hover
  crosshair across all charts with a value readout, a "Show data table"
  view. Hidden when there is no history (older runs).
  **Deviation (deliberate):** the spec asked for chart (a) to show users
  *and* requests/sec together. Those have different units, so one chart
  would need two y-axes, which misleads readers. Instead there are three
  small charts on the same time axis: Active users; Throughput (requests/s
  and failures/s — same unit); Response time (running average and rolling
  p95 — same unit). Series colours come from a palette checked with the
  colour-blindness validator against the app's dark surface (all checks
  pass).
  Note for the viva: Locust's history file only has a *running* average
  response time ("Total Average Response Time"), so the p95 line (a short
  rolling window) is the one that reacts quickly to slow-downs.
- 3.2 Custom cases. `analysis/custom_cases.py` → `classify_custom_case(sample,
  payload, label=None)` (label is an optional third argument so the label
  rules can live in the same pure function). Rejects non-objects, bad labels
  (`^[a-z0-9_]{1,40}$`), labels that collide with a generated case, and
  payloads with no differences ("identical" is decided by the diff, not
  `==`, because Python treats 30 == 30.0 and 1 == True as equal). Describes
  removed / set-to-null / type-changed / value-changed / added fields;
  category is missing_field / null_value / type_mismatch when that is the
  only kind of change, else custom.
  New `POST /api/validate-custom-case`. `/api/confirm-selection` accepts an
  optional `custom_cases` list, re-validates each one server-side, rejects
  duplicates, appends them (category "custom"); with custom cases present an
  empty `selected_labels` is allowed. Without `custom_cases` the behaviour and
  error messages are exactly as before (tested).
  Frontend: "Add your own case" (label + JSON + "Validate and add") under the
  case list; valid cases appear with a blue [custom] tag, selected by
  default, removable with ×, included in Select all/none, the count and a
  "custom" chip. Regenerating edge cases clears custom cases (they were
  validated against the old sample). In results, custom cases fall in the
  "Other / custom" group.

**Tests**: `test_history_merge.py` (7), `test_custom_cases.py` (22),
`test_custom_case_endpoints.py` (8). 73 passed, all four ways.

**Verified (browser, mock target; form filled with the page's own inputs,
run size set through the console)**
- Identical-to-sample case → "Not an edge case — identical to the sample",
  nothing added. Malformed JSON → "Payload is not valid JSON: …", nothing
  added. `admin_user` (username "admin") → added as custom, "27 of 27
  selected".
- 15 users / 30 s (single job): `admin_user` row 16/16 failed; Timeline drew
  3 charts (users 0→15, ~11 req/s, avg ~105 ms / p95 ~150 ms). Hover (via a
  synthetic mouse event — real pointer coordinates are offset in this pane)
  showed crosshairs in all 3 charts and the readout.
- 150 users / 30 s (split, 3 workers): `admin_user` 110/110 failed and listed
  under 429 ×68 and 400 ×42 in "Why did these fail?"; merged timeline shows
  users ramping to 150 and failures/s tracking requests/s.
- Comparing those two runs: `admin_user` present in the per-case table
  (100% → 100%, not changed); the three tolerated expiresInMins cases flagged.

**Found while verifying**: Vite's file watcher on Windows sometimes misses a
save when several edits land quickly — the page served old code until the
dev server was restarted. If something looks out of date in the demo,
restart `npm run dev`.

**Check by hand**: hover the timeline with a real mouse.

---

## Tier 4 — Baseline/regressions and downloadable report

**Built**
- 4.1 Baseline. New `is_baseline` column on jobs and job_groups (defensive
  ALTER, default 0). `job_store.set_baseline(run_id, target_url)` clears the
  flag on every job and group of that target, then sets it on the chosen run
  — so there is one baseline per target. `get_baseline_id(target_url)`.
  `/api/jobs` rows now also carry `is_baseline` (additive).
  Endpoints: `POST /api/baseline {"id"}` (completed runs only; 404 unknown),
  `GET /api/baseline?target_url=…`, `GET /api/regressions/<run_id>` →
  `{target_url, baseline_id, is_current_baseline, baseline, regressions,
  baseline_p95, current_p95, p95_change_pct, threshold, min_requests}`.
  Pure function `analysis/regressions.py → detect_regressions()`: a case is a
  regression if its failure rate rose by ≥ 10 points with ≥ 5 requests on
  both sides; plus p95 change in percent (uses the first "Aggregated" row, so
  old duplicated rows are handled).
  Frontend `components/RunActions.jsx` under the result: "Mark as baseline",
  "★ This run is the baseline…", and a "Compared with baseline" panel (p95
  change with ▲/▼, list of regressed cases). The history checklist shows
  "★ baseline". Fetched by a `useEffect` when a result arrives —
  `pollStatus()` is unchanged.
  Note: "target" means `target_url` as stored, which is the host
  (e.g. `http://127.0.0.1:8000`) — the existing code stores the path
  separately. Two different endpoints on the same host share one baseline.
- 4.2 Report. `utils/report.js → buildMarkdownReport()` + "Download report
  (.md)" button: target, configuration, summary (with ≈ note for split
  runs), failure types, per-case table, baseline comparison if any,
  generation time. Built in the browser with a Blob — no backend change.

**Tests**: `test_regressions.py` (8), `test_baseline_endpoints.py` (5, temp
DB). 78 passed, all four ways.

**Verified (browser, mock target)**
- 15 users / 30 s run → clicked "Mark as baseline" with a real click →
  "★ This run is the baseline for http://127.0.0.1:8000", button hidden,
  history shows "★ baseline".
- 150 users / 30 s run → "Compared with baseline": p95 ▲ 5.7% (150 → 159 ms),
  "3 cases got worse by 10+ points": missing / zero / null_expiresInMins
  (0% → 57–66%). Credential cases not listed.
- Download report: the file was **not saved to disk** (downloading needs
  your permission). I intercepted the generated Blob in the console and read
  it: `load-test-report-fdeb2f80.md`, type text/markdown, 3.9 KB, with all
  sections including the baseline table.

**Check by hand**: click "Download report (.md)" yourself and open the file.

**Environment note**: the mock target and backend I ran in the background
were stopped by the tool's time limit once and restarted; no code impact.

---

## Final step

**Written**: `docs/features.md` (plain-English guide: what / why / how /
files / 1-minute demo / two teacher questions per feature, jargon defined
up front). Feature lists added to `README.md` and `docs/index.md`;
`docs/index.md` workflow step 5, endpoint table (new endpoints) and
run instructions (mock target) updated; `code/README.md` layout updated.

**Final checks**
- `npm run build` — clean (no errors or warnings).
- pytest — 78 passed with `python -m pytest` and `pytest`, from `code/` and
  from the repo root, and in a GitLab-like copy of `code/` with plain
  `pytest`.
- No new npm or pip packages (`package.json`, `requirements.txt` untouched).
- All seven protected behaviours re-checked in the final code.

**Check by hand**
- `docs/index.md` still names the team as Yash Bharadwaj, Nikhil Khosla,
  Krish Agrawal, while `README.md` (which you edited) says Vivek Pandey,
  Anant Agrawal, Piyush Singh; the `journals/` folders use the old names too.
  Left as is — your call.
- The docs site has no nav file (`summary.md`), so mkdocs lists every page in
  `docs/` automatically — `features.md` will appear; it is also linked from
  `docs/index.md`.

---

# Build log — extension tiers 1–4 (problem rate, stop, auth headers, CI gate, repeats)

Same rules as before: no git commands, no new packages, additive backend
changes only. **browser** = seen in the running UI (dev server on 5173);
**API/script** = checked by calling the backend from a Python script.

## Tier 1 — small fixes to known limitations

**Built**
- 1.1 Problem rate. `analysis/problem_rate.py` → `problem_rate(failure_summary,
  stats_csv)` = (5xx + 429 + connection failures) / total requests, one
  decimal. Added in `app._with_failure_summary()` so every status response
  (single and group) and both compare forms carry `problem_count` and
  `problem_rate` (additive). Frontend: "Problem rate" key figure after
  Failure rate with a tooltip explaining the difference; a "Problem rate %"
  row in the comparison table; a row plus a one-line explanation in the
  Markdown report. Failure rate is unchanged everywhere.
- 1.2 Stop. `load_test_runner._run_locust()` now uses `subprocess.Popen` +
  `communicate(timeout=duration+60)` with the same command, output capture
  and timeout handling (on timeout: kill, collect output, status "timeout",
  exactly what `subprocess.run` did). Processes are tracked in `_processes`.
  `cancel_run(id)` handles a single job or every child of a group: a running
  job's process is terminated, a queued job is marked cancelled straight
  away (and never starts Locust). After the process exits, the runner stores
  status `cancelled` with whatever CSVs Locust had already written (Locust
  rewrites them every few seconds), so partial results survive. Group status:
  `cancelled` once every child has stopped and at least one was cancelled;
  partial child results are merged like a completed group.
  `POST /api/cancel/<id>` → 202 `{status: "cancelling"}`, 404 unknown id,
  409 with an explanation when `USE_SQS=true`. `job_store` sets
  `completed_at` for cancelled jobs and groups.
  Frontend: "Stop test" next to the progress text while queued/running →
  "Stop now? Results so far are kept. [Yes, stop] [Keep running]" →
  "Stopping…". "cancelled" is terminal in `pollStatus()`, shown as
  "Cancelled" (amber) in the run panel and history, "cancelled — partial"
  in comparison headers, "cancelled — partial results" in the report, and
  the result says "Cancelled — partial results…" or "…no results were
  recorded…".
- 1.3 Lost connection. Inside `pollStatus()` only: the fetch is wrapped in
  try/catch. A failed poll shows "Lost connection to the backend —
  retrying" and retries after the same 2 s; a successful poll clears it.
  After 15 failures in a row polling stops and shows "Status unknown — the
  backend is unreachable" with "Check again" (resumes polling). `testRunning`
  is released only in that final state. The interval and the completion
  check are otherwise unchanged (the completion list gained "cancelled", as
  1.2 requires).

**Tests**: `tests/test_problem_rate.py` (7), `tests/test_cancel.py` (10:
fake Popen — cancel keeps partial CSV, no CSV → no results, uncancelled run
still completes, timeout still "timeout", queued job never starts, group
cancel stops all children and merges partials, group stays "running" until
every child stops, endpoint 202/404, SQS → 409, finished job untouched).
95 passed.

**Verified**
- Browser, mock target, 15 users / 15 s: Problem rate 10.5% (16 × 500 of
  152) next to Failure rate 88.2%.
- Browser, 15 users / 30 s, Stop after 10 s through the confirm step:
  "Stopping…" → "Cancelled" about 1 s later, "Cancelled — partial results",
  82 requests kept; start button enabled again. So on Windows, Locust's
  CSVs survive `terminate()`.
- API/script, 150 users (3 workers) cancelled after 12 s: all children
  `cancelled`, group `cancelled`, one merged Aggregated row (1,183 requests),
  problem rate 63.7%; history and `/api/compare-jobs` show it as cancelled.
- Browser, lost connection simulated by making the status request fail in
  the page (the backend itself stayed up): "retrying" banner while failing
  with the start button still disabled; after ~30 s "Status unknown…" +
  "Check again", start button enabled, Stop hidden; "Check again" → retrying
  → banner gone, run shown as Completed with results.
- Browser: comparison of 3 runs shows the problem-rate row with ▲/▼ and
  "cancelled — partial" headers; the report (Blob intercepted, not saved)
  has the Problem rate row and the explanation.

**Check by hand**
- Stop a run yourself and confirm the partial numbers look plausible.
- Kill the backend (Ctrl+C) during a run: you should see the retrying
  banner, then "Status unknown" after about 30 s. (Restarting the backend
  does not bring the run back — it lived in the old process — so "Check
  again" will then report whatever the database last recorded, normally
  "running". That is a limitation of in-process jobs, not of the banner.)
- On Linux/k3s `terminate()` sends SIGTERM, which Locust handles by
  stopping and writing final CSVs; only Windows was tested here.

## Tier 2 — authenticated APIs

**Built**
- 2.1 Request headers. `analysis/request_headers.py`: `clean_headers()`
  (object of name → value; RFC token names; single-line values, trimmed;
  ≤ 20 headers, ≤ 4096 chars; error messages name the header, never the
  value), `header_names()`, `redact()`.
  - `/api/analyze` accepts optional `headers` and the probe sends them
    (`sanity_check(url, headers)`); any probe error text is redacted.
  - `/api/start-load-test` and `/api/start-website-load-test` accept optional
    `headers`; they travel in memory to `_run_api_job` / `_run_website_job`
    (new optional last parameter, so `worker.py` still works) and reach
    Locust **only** as the environment variable `LOCUST_HEADERS`. Both
    locustfiles read it and send the headers with every request. No file
    holding values is ever written, so there is nothing to delete afterwards.
  - Only names are stored: new `header_names` column (JSON list) on `jobs`
    and `job_groups`, added with the existing try/ALTER pattern; returned
    as a list on status responses. Locust's stdout/stderr and failures CSV
    are passed through `redact()` before storage, in case anything echoes.
  - In SQS mode a run with headers is refused (409): the queue message would
    carry the values to another machine.
  - Frontend: `components/RequestHeadersEditor.jsx` in step 2 ("Request
    headers (optional)"): name/value rows, value in a password field, Add /
    Remove. Sent with Analyze and both start requests. The run panel shows
    "Sent with request headers: Authorization (values hidden)"; the report
    lists names only.
  - Small related fix: 401/403 are now explained as "Rejected — not
    authorised (check the request headers)" (backend meaning) and the
    summary says "N requests were refused as not authorised (401); check
    the request headers" instead of "rejected as invalid input".
- 2.2 Mock: `MOCK_REQUIRE_TOKEN` — when set, any request without
  `Authorization: Bearer <token>` gets 401 before other rules. The startup
  line says "bearer token required" without printing the token. Documented
  in `code/scripts/README.md`.

**Tests**: `tests/test_request_headers.py` (21): validation cases, error
messages without values, `redact`; through the API (dispatch mocked) for a
single run, a split run and a website run — the whole SQLite database
(`iterdump`), the start/status/jobs responses contain no value, names are
stored; analyze sends the headers and never returns them; probe error text
redacted; the runner (fake Popen) gets the values only in `LOCUST_HEADERS`,
not in the command line, writes no file containing them, and redacts an
echoed value from stdout. Plus one failure-summary test for 401/403.
117 passed.

**Verified**
- Script: mock with `MOCK_REQUIRE_TOKEN=demo-token` → 401 without header,
  401 with a wrong token, 200 with the right one.
- Browser, 15 users / 10 s, no header: every request 401 (failure 100%,
  problem rate 0%), summary "rejected … (401)" (before the wording fix).
- Browser, same with `Authorization: Bearer demo-token` added in the
  editor: value field is a password field; the start request body carried
  the header; results as without a token (400s + 500s, problem rate 16.3%);
  "Sent with request headers: Authorization (values hidden)"; the token
  does not appear anywhere in the page text.
- API/script, 120 users (3 workers) with the header: 0 × 401, completed,
  `header_names: ["Authorization"]`; the token is absent from the API
  responses, the whole database dump, every file under
  `load_test_results/`, and the backend and mock console logs.

**Check by hand**
- Restart the mock without `MOCK_REQUIRE_TOKEN` for normal demos.
- Header values are kept in the page's memory only, so a page reload clears
  them; re-enter the token after reloading.

## Tier 3 — CI regression gate

**Built**
- `scripts/regression_gate.py` (standard library + requests). Arguments:
  `--api --url --sample` (required), `--users` (50), `--duration` (30),
  `--spawn-rate` (10), `--baseline-id`, repeatable `--header "Name: value"`,
  `--poll-interval` (2 s), `--timeout` (duration + 300 s). Flow: generate
  all edge cases → confirm them → start the run (split above 50 users as
  usual) → poll status → `GET /api/regressions/<run>` → print a summary →
  exit 0 (no regressions), 1 (regressions), 2 (any error: bad arguments,
  backend unreachable or returning an error, run failed/timed out/cancelled
  or never finished, no baseline, unknown `--baseline-id` — checked before
  the run starts). `decide()` is a pure function; `run_gate()` takes the
  HTTP object and sleep function as parameters so tests inject fakes.
- Backend (additive): `/api/regressions/<id>?baseline_id=<id>` compares with
  that run instead of the stored baseline (404 if it does not exist).
  Without the parameter the endpoint behaves exactly as before.
- `scripts/gate_sample.json` (the mock's sample body).
- `code/.gitlab-ci.yml`: new `regression-gate` job, `when: manual`,
  `allow_failure: true`, `needs: []`, configured by CI/CD variables
  `GATE_API_URL`, `GATE_TARGET_URL`, optional `GATE_BASELINE_ID`. The
  existing `test`, `build` and `deploy` jobs are unchanged.
- `code/scripts/README.md`: usage, exit codes, example output, CI notes.

**Tests**: `tests/test_regression_gate.py` (23): `decide()` for pass / fail /
no baseline / unknown p95; argument defaults, headers, baseline id, and five
bad-argument cases exiting with 2; full runs against a fake backend (exit 0,
exit 1, baseline id and headers passed on, failed/cancelled/timeout runs →
error, gives up after the timeout, unreachable backend, unknown baseline id
before any run starts, bad sample file, `main()` maps errors to 2); the
backend's new `?baseline_id=`. 140 passed in total.

**Verified (script, against the running backend and the mock with the
token on, using `--header`)**
- 15 users / 15 s → "PASS: no case's failure rate rose…", exit 0.
- 150 users / 15 s (split into 3) → "FAIL: 3 case(s) got worse…"
  (null/missing/zero_expiresInMins 0% → 50–62%), exit 1.
- `--baseline-id <the 150-user run>` with a 5-user run → PASS, exit 0.
- Unreachable backend (port 5999) → "ERROR: cannot reach the backend…",
  exit 2. `--baseline-id nope` → "ERROR: … returned 404", exit 2, no run
  started.

**Check by hand**
- No YAML parser is installed here (and none was added), so paste
  `code/.gitlab-ci.yml` into GitLab's CI Lint (CI/CD → Editor → Validate)
  once, to confirm the new job parses and is listed as manual.
- The runner needs network access to `GATE_API_URL` and the target; the
  example uses the same `k3s` tag as the other jobs.

## Tier 4 — repeated runs (series)

**Built**
- "Repeat" (1–5, default 1) in the load settings (both the API and the
  website blocks). `repeat` is an optional field on both start endpoints;
  with 1 (or absent) the response and behaviour are exactly as before.
- With repeat > 1 the backend creates a **series** (`series` table, created
  with `CREATE TABLE IF NOT EXISTS` in `init_db()`: configuration,
  `repeat_count`, `run_ids` JSON list, status, error, header names) and a
  background thread (`load_test_runner._run_series`) that starts one
  ordinary run (single or split, through the unchanged start functions),
  waits for it to finish, records its id, and starts the next. A failed /
  timed-out / cancelled repeat ends the series. Series status: queued →
  running → completed / failed / cancelled.
- The series id is returned as `job_id` (plus `series_id`, `is_series`,
  `repeat`), and `/api/load-test-status/<id>` recognises series ids first,
  so the browser polls a series with the unchanged `pollStatus()`. A series
  status lists each repeat (`runs`: id, status, split or not, problem rate)
  and, once stopped, `series_summary`.
- `analysis/series_stats.py` → `summarize_series(runs)` (pure): for the whole
  run, mean, sample standard deviation (n − 1; none with one repeat), min,
  max and per-repeat values of throughput (requests/s), p95 and problem
  rate; per case, mean failure rate, min–max and the number of repeats it
  appeared in, highest mean first. Only completed repeats are summarised.
- Stop: `cancel_run(series_id)` marks the series cancelled (no further
  repeats start) and cancels the current repeat (single or every child of a
  group). The series thread also re-checks right after starting a repeat.
- testRunning: a series is one run for the browser (status queued/running
  until the last repeat ends), so the existing guard covers it. The progress
  estimate is duration × repeat.
- Frontend `components/SeriesSummary.jsx`: "Series summary" with a
  whole-run table (Mean ± SD and each repeat's value) and a per-case table
  (mean fail %, min – max highlighted when it spans 10+ points, repeats),
  plus "Repeats: #1 completed (split) · …". Baseline/report buttons are not
  shown for a series (they apply to single runs); each repeat appears in
  the history and can be compared or marked as baseline there.

**Tests**: `tests/test_series_stats.py` (6) and `tests/test_series.py` (14):
all repeats complete; a failed repeat ends the series; the loop waits for
each repeat; cancel stops the current repeat and starts no more; status
endpoint with runs and summary (and none while running); cancel endpoint
accepts a series; start endpoints: repeat 1 = old response, repeat 3 starts
a series of ordinary runs, a series of split runs (3 children), bad repeat
values → 400, website series. 160 passed in total.

**Verified**
- Browser, mock, 15 users × 10 s × repeat 3 (Repeat typed as 9 → "Set to 5,
  the maximum", then 3): request body carried `repeat: 3`; "Test in
  progress…" until all three ended; summary: throughput 12.21 ± 0.34 req/s,
  p95 153 ± 6 ms, problem rate 6.1 ± 2.8 %, per-case table, "Repeats: #1
  completed · #2 completed · #3 completed"; start enabled again.
- Browser, 120 users (split into 3) × 10 s × repeat 3, Stop + confirm during
  the series: status Cancelled; "Only 2 of 3 repeats completed before the
  series was stopped"; summary over the two completed split repeats
  (88.47 ± 0.43 req/s, p95 ≈152 ms); API check: series `cancelled`, repeats
  completed/completed/cancelled, all 3 children of the last repeat
  cancelled, and all 3 repeats listed in `/api/jobs`.
- API/script: website series (mock as the target, 2 users × 3 s × 2) →
  completed, 2 repeats summarised.

**Check by hand**
- A series is not listed as one item in the run history (its repeats are);
  after a page reload its summary is reachable only by its id through
  `/api/load-test-status/<series id>`.
- While a series runs, the page cannot show "repeat 2 of 3" because
  `pollStatus()` only reads the status until the end (kept unchanged on
  purpose); the progress bar covers the whole series.

## Final step (extension)

**Written**: `docs/features.md` entries 17–22 (problem rate, stop, lost
connection, request headers, CI gate, repeated runs) in the same format,
three new glossary terms, and a "Job states" section with the state diagram
including `cancelled`. Feature lists in `README.md` and `docs/index.md`;
`docs/index.md` endpoint table (cancel, headers, repeat, `?baseline_id=`).
`docs/ux-review.md`: U12, U13, U17 changed from "Deferred" to "Fixed later
(extension Tier 1.x)".

**Final checks**
- `npm run build`: clean.
- pytest: 160 passed with `python -m pytest` and `pytest`, from `code/` and
  from the repo root, and in a GitLab-like copy of `code/` with plain
  `pytest`.
- No new npm or pip packages.
- Browser smoke after all tiers: URL change blocks start until re-analysis
  (and unblocks when restored); start button shows "Test in progress…"
  during a run; a 3-user run completes; the history lists single runs and
  split groups together (18 + 8 = 26 rows, matching the database); no
  console errors.
- Background backend, mock target and the preview dev server were stopped.
