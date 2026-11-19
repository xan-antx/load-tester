# UI revamp plan (ui-revamp branch)

Source: `/impeccable critique` (dual-agent) of the current frontend. Score
**24/40**, Acceptable, with three P1 issues. The snapshot is in
`.impeccable/critique/`. Product truth is in `PRODUCT.md` and the visual
system in `DESIGN.md`. The earlier review is `docs/ux-review.md`.

## What the critique found (short)

1. **Results tell the truth in the wrong order.**
   - The SLO banner renders above the findings.
   - The headline finding is always green.
   - `slice(0, 4)` silently drops findings, for example rate limiting on a run
     where 47% of requests were 429s.
   - Cases that got 0 requests disappear from the stats, so a run can look
     clean while 7 cases were never sent.
2. **One word, three numbers.**
   - "Unexpected" in the table is 43 and includes 5xx.
   - "Unexpected answers" in the SLO is 24.
   - Compare shows "Failure rate %", and there is also a separate "Problem rate".
3. **Nothing is above the fold after Start.** The progress bar sits at
   965 px in a 900 px viewport, and the results land below it.
4. **Errors appear far from their cause.** There is one banner at the top of
   the page, and focus jumps there.
5. **Step 3 is overloaded.** It has more than 40 controls and a 380 px
   scroll well. The descriptions repeat ("SQL injection attempt in
   'username'" ×3), and the payloads are never shown.
6. **The detector found:**
   - mono labels in about 20 places (a Mono Means Measured violation);
   - side-tab borders on the SLO and capacity banners;
   - nested bordered boxes;
   - 01–05 numbered labels;
   - paragraphs of over 100 characters;
   - all buttons defaulting to `type=submit`;
   - case checkboxes named "on".

## Information architecture

There are three views, switched by a tiny hash router (`#/new`, `#/run`,
`#/history`). It needs no dependency, and the browser Back button works.

| View | Contents |
|---|---|
| **New test** | **Main column:** target URL, then the analyze chip (reachable, status, API/website, with a "?" popover holding the long explanation), then ownership, then the sample JSON with inline validation, then the case table. **Sticky side column:** preset, mode (Fixed load / Find capacity), load numbers, request estimate, SLO, and **Start**, which is always visible. |
| **Run** | Opens at the top of the viewport. Live progress first, then the results: the findings headline, coverage, KPIs, the outcome bar, the SLO card, the case table, "Why did these fail?" and charts, then actions (Mark as baseline, Download report, Re-run with same settings, Edit and re-run). |
| **History** | The run list: relative time, full target path, users, mode, status, verdict, findings count. Empty columns are hidden. Baselines are managed here. Compare 2–4 runs with an explicit "reference run" marker. |

A **run pill** in the header shows a running test (elapsed / about total,
plus Stop) from any view. The health light stays subtle while the backend is
connected. When it is offline, a full-width banner appears under the header.

## One "unexpected" concept

A request's answer is **unexpected** when it differs from what a correct API
gives: valid input should get 2xx, invalid input a 4xx rejection, and a 429,
a 5xx or no answer never counts as correct. So
**unexpected = total − handled correctly**. It is broken down by outcome kind
(accepted invalid input, rejected valid input, server error, rate limited,
connection, other).

That one number drives:
- the KPI ("Unexpected answers 8.2%, 11 of 134");
- the outcome bar ("Expected answer" plus the kinds);
- the case table's "Unexpected" column;
- the chart's "unexpected/s" line;
- Compare and the report.

"Problem rate" and "Failure rate" go away. For legacy runs without
expectations, unexpected = Locust failures and the label says so.

**Bugs** are cases whose unexpected answers show a defect: accepted invalid
input (a validation bug), rejected valid input, and server errors. Rate
limiting and connection failures are load effects, reported separately.

**Coverage:** the cases sent (`case_expectations` keys) are compared with the
stats rows that have requests. A case with no row, or 0 requests, is
**untested**, and it is shown in its own grey state and never as a green 0%.

## Components and modules

```
src/
  router.js               hash router (useView)
  api.js                  BASE, fetchJson, error text
  hooks/useHealth.js      polling, offline state
  hooks/useTarget.js      url, analyze, ownership
  hooks/useCases.js       sample, generate, select, expect, custom cases, filters
  hooks/useLoadSettings.js presets, fixed/capacity, SLO, estimate
  hooks/useRun.js         start, poll, stop, result, regression info, run config store
  hooks/useHistory.js     list, baseline, compare
  utils/runReport.js      the one derivation of findings, coverage, unexpected and bugs
  utils/estimate.js       request estimate and untested-case risk
  utils/runStore.js       localStorage of run configs (payloads, full URL, settings)
  views/NewTestView.jsx, views/RunView.jsx, views/HistoryView.jsx
  components/…            small pieces (FindingsHeadline, CoverageLine, KpiRow,
                          SloCard, CaseResultsTable, FailureReasons, Timeline,
                          CaseTable, LoadPanel, SloFields, RunPill, Popover, …)
```

## Order of work (priority order, demo first)

The app must work after every step, so each step ends with lint and build
passing, a real run against the mock, and a commit.

1. **Results.**
   - Findings headline first (cases and payloads named), then coverage and
     untested cases, then the SLO as a secondary card.
   - One unexpected metric throughout.
   - Charts get a data-scaled y-axis, SLO threshold lines and a ramp-up band.
   - Failures sit next to their case and payload.
   - New actions: Re-run and Edit and re-run.
2. **Visual cleanup.**
   - Mono only for data, everywhere.
   - Remove the side-tab borders and nested boxes.
   - Weight before size; projector-readable captions.
   - Inline errors next to their controls.
   - Health light subtle, offline banner prominent.
3. **New test view.**
   - Three-view IA.
   - Compact setup with a sticky Start.
   - Case table with chips, search, payloads and a segmented expected-answer control.
   - Presets and a live estimate with a zero-request warning.
   - SLO fields with an explicit "off" state.
4. **History view.** The run list, baselines, and Compare with a reference marker.
5. **Final checks.**
   - break-ui with worst-case data;
   - accessibility and UX heuristics review;
   - `/impeccable audit` and polish;
   - the docs: DESIGN.md, the design.json sidecar and docs/ux-review.md.

## Backend changes recommended but NOT made

1. **Coverage guarantee.** `dynamic_locustfile.py` picks `random.choice(CASES)`
   per request (with a 0.5–2 s wait), so no case is guaranteed a request.
   Iterating each user over a shuffled cycle, offset by user index (for
   example `itertools.cycle` per user starting at `id % len(CASES)`), would
   send every case once the run has at least N requests per process.
2. **Store the target path.** `jobs.target_url` stores only the host, and the
   path is never persisted. History therefore cannot show the full target for
   runs started elsewhere (the CLI, other browsers). The frontend keeps the
   full URL locally for runs it started.
3. **Store the case payloads per run.** These are needed to show the
   triggering payload and to re-run from History for runs not started in this
   browser.
4. **Findings and coverage counts in `/api/jobs`.** Today History would need
   one status request per run to show a findings count.

## Decisions made overnight

- **The plan was self-approved** (you asked for unattended work), and the
  questions at the end of the critique were skipped for the same reason.
- **Dev environment.** :5000 is the Docker backend, whose CORS allows only
  :8080, and :8000 is another project's mock (`load-tester-java-mock-1`). So
  I added two launch configs:
  - `backend-dev`: the source backend on **:5001**;
  - `mock-dev`: our `code/scripts/mock_target.py` on **:8001**.

  `code/frontend/.env.local` (git-ignored) points Vite at :5001. The real flow
  was tested against `http://127.0.0.1:8001/api/login`. No container was
  stopped.
- **Run configs are kept in `localStorage`** (cases with payloads, the full
  URL, settings), keyed by run id, capped at 50 entries and wrapped in
  try/catch. This powers payloads in findings, Re-run and the full target
  path, without a backend change. Runs started outside this browser show case
  names only.
- **Router:** a hash router of about 30 lines instead of react-router, so
  there is no new dependency.
- **Presets:**
  - Smoke: 5 users, 5/s, 20 s.
  - Normal: 25 users, 5/s, 60 s.
  - Stress: 150 users, 20/s, 60 s.
  - Custom keeps whatever the user typed.
- **Estimate model:** each virtual user sends about 1 request per
  (1.25 s mean wait + average response time); ramp-up counts as
  users / spawn rate. Expected untested cases ≈ N·e^(−requests/N). The UI
  warns when that is 0.5 or more.
