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
