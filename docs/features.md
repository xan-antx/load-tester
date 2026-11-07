# Features explained

This page explains every feature added to Elevate Load Tester in the final
build, in plain English. For each one: what it does, why it exists, how it
works, which files it touches, how to demo it in under a minute, and two
questions a teacher might ask (with short answers).

## A few words first

- **Load test** — sending many requests to a server at the same time, to see
  how it behaves under pressure. We use a tool called **Locust** to do this.
- **Virtual user** — one simulated person sending requests in a loop. "150
  users" means 150 of these running at once.
- **Edge case** — an unusual input, such as a missing field, a `null`
  value or a huge number. Good servers reject bad input cleanly; weak servers
  crash.
- **HTTP status code** — the three-digit number a server sends back with
  every answer. 200 = OK. 4xx (like 400) = "your request was wrong". 429 = "too
  many requests, slow down". 5xx (like 500) = "the server itself broke".
- **CSV** — a plain text table, one row per line, columns separated by
  commas. Locust writes its results as CSV files.
- **Endpoint** — one URL of our backend that the frontend calls, for example
  `/api/compare-jobs`.
- **Split run** — runs with more than 50 users are divided into several
  smaller "child" jobs (up to 50 users each) that run in parallel. Their results
  are then merged into one.
- **Percentile (p95)** — sort all response times from fastest to slowest; the
  p95 is the time that 95% of requests beat. It shows the slow tail that an
  average hides.
- **Request header** — a named extra line sent with a request, such as
  `Authorization: Bearer <token>`, which proves who is calling.
- **Exit code** — the number a command-line program returns when it ends; 0
  means success. CI pipelines pass or fail a step on it.
- **Standard deviation (SD)** — how far values typically sit from their mean.
  "12.2 ± 0.3" means the repeats were very close to each other.

---

## 1. Local mock target

**What it does.** A tiny fake login API (`POST /api/login` on
`127.0.0.1:8000`) that we can load-test instead of a real website.

**Why it exists.** Public APIs change, rate-limit us unpredictably and need
internet. A local target gives the same results every time, works offline, and
we know exactly how it should behave.

**How it works.** It accepts `demo` / `demo123`. Bad usernames or passwords
get 400. The optional `expiresInMins` field is handled carefully for missing,
null, 0 and negative values, but deliberately *not* for text or huge numbers.
Those cause a crash (500), like a real server with a missing check. A rate limiter
returns 429 once more than 40 requests arrive in the same second.

**Files.** `code/scripts/mock_target.py`, `code/scripts/README.md`.

**Demo (≈1 min).** Run `python scripts/mock_target.py` in `code/`. In the
app, analyze `http://127.0.0.1:8000/api/login` with sample
`{"username": "demo", "password": "demo123", "expiresInMins": 30}`, generate
cases, and run 15 users for 30 s.

**Teacher might ask.**
- *Why build a fake server instead of testing a real one?* — So results are
  repeatable and we never put heavy load on someone else's server. A test you
  can't repeat can't be trusted.
- *Why does it crash on purpose?* — To prove the tool can tell "server rejected
  bad input" (400) apart from "server broke" (500). The second one is a real
  bug a developer would want to know about.

---

## 2. Failure types (instead of 49 "distinct errors")

**What it does.** Under "Why did these fail?", failures are grouped into a few
types by status code: **Rejected — invalid input** (4xx), **Rate limited** (429),
**Server error** (5xx), and **Connection failure** (no answer at all). Each
card shows a coloured code badge, the total, and which cases hit it.

**Why it exists.** Locust puts the case name inside every error message, so 26
cases looked like 49 different errors. Grouping by status code shows what
actually happened.

**How it works.** The backend reads Locust's failures CSV, finds the status
code inside each error text with a pattern match, and adds up the counts per
code. The old raw list is still there behind "Show raw errors".

**Files.** `code/frontend/src/theme.js` (the colour for each failure type),
`code/analysis/failure_summary.py`, `code/app.py` (adds a
`failure_summary` field), `code/frontend/src/components/JobResultSummary.jsx`,
`code/tests/test_failure_summary.py`.

**Demo.** After a 150-user mock run, open "Why did these fail?": you see three
cards (429 blue, 400 amber, 500 red). Their totals add up to the failure count
on the Failure Rate card.

**Teacher might ask.**
- *Why is 429 separate from the other 4xx codes?* — 400 means the input was
  bad; 429 means the input might be fine but we sent too much too fast. They
  need different fixes.
- *What if an error has no status code?* — It goes into "Connection failure",
  for example when the server refused the connection or timed out.

---

## 3. p95 response time

**What it does.** Adds a "p95 Response" card and a p95 column next to the
average.

**Why it exists.** An average can look fine while 1 in 20 users waits a long
time. p95 shows that slow tail.

**How it works.** Locust already writes percentiles in its stats CSV; we
display the "95%" column. For split runs the value can't be merged exactly, so
we show "≈" and a tooltip: it is a request-weighted average of each worker's
p95.

**Files.** `JobResultSummary.jsx`, `CompareView.jsx`, `code/stats_aggregator.py`
(documents the approximation).

**Demo.** Point at the p95 card after any run. On a 150-user run it shows
"≈ … ms (approx. split run)"; hover it to read why.

**Teacher might ask.**
- *Why can't percentiles be merged exactly?* — You would need every single
  response time from every worker, but each worker only reports its own
  summary. Averaging summaries gives a close estimate, not the true value.
- *Why p95 and not the maximum?* — The maximum is one unlucky request; p95
  describes what a meaningful share of users experience.

---

## 4. Local timestamps

**What it does.** Run times show in your own time zone (e.g. 10:42 PM) instead
of the server's UTC time.

**Why it exists.** SQLite stores time in UTC without saying so, which made
times look hours off.

**How it works.** `formatTime()` adds a "Z" (meaning UTC) before parsing, so
the browser converts it to local time. Sorting still uses the original text,
so the order never changes.

**Files.** `code/frontend/src/utils/formatTime.js`, `App.jsx`, `CompareView.jsx`.

**Demo.** Look at the run list in "Compare past runs".

**Teacher might ask.**
- *Why not store local time in the database?* — Servers and users can be in
  different time zones; storing UTC and converting only for display is the
  standard practice.
- *What if the timestamp is broken?* — The function shows the original text
  instead of crashing.

---

## 5. Website mode labels

**What it does.** For website runs the first column says **Page** (not "Edge
Case"), and the Flat/Grouped toggle is hidden.

**Why it exists.** Website tests visit page paths like `/about`; those aren't
edge cases and don't belong to edge-case categories.

**How it works.** A run is a website run if the group says
`job_type = "website"`, or if every row name starts with `/`. Page paths
always start with `/`, while edge-case labels never do.

**Files.** `JobResultSummary.jsx`.

**Demo.** Analyze `https://example.com` and run 2 users for 5 s.

**Teacher might ask.**
- *Why check names starting with "/" instead of storing the type?* — Single
  (non-split) jobs never stored their type; this rule works for old runs too
  without changing the database.
- *Could an edge-case label start with "/"?* — No. The generator builds labels
  like `missing_username`, and custom labels may only use lowercase letters,
  digits and `_`.

---

## 6. Merge bug fix (one "Aggregated" row)

**What it does.** Fixes split runs, whose merged results used to contain a
second, double-counted total row.

**Why it exists.** Each child job's own total was merged like an ordinary case,
then a new total was added on top. The second total was exactly double.

**How it works.** The merge now skips each child's own total and builds one
fresh total from the per-case rows. Unit tests check a 3-child merge.

**Files.** `code/stats_aggregator.py`, `code/tests/test_stats_aggregator.py`.

**Demo.** Not visible in the UI (the UI already read the first, correct row).
Show the test: `pytest tests/test_stats_aggregator.py`.

**Teacher might ask.**
- *How did you find it?* — While reading the merge code, then confirmed it on a
  real 150-user run in the database: 802 vs 1604 requests.
- *Why didn't users notice?* — The frontend happened to use the first total row,
  which was correct. New features that read "the total" could have picked the
  wrong one.

---

## 7. Compare 2 to 4 runs

**What it does.** Tick 2–4 past runs (single or split) and compare them in one
table. Every run after the first shows a ▲/▼ percentage against Run 1.

**Why it exists.** Real questions need more than two runs, e.g. "15, 50 and 150
users — where does it break?"

**How it works.** The frontend sends `{"job_ids": [...]}` to
`/api/compare-jobs`; the backend returns the runs in the same order. The old
two-run form still works. Colours depend on meaning, not direction: more
throughput is green, but more failures or slower responses are red.

**Files.** `code/app.py`, `App.jsx` (checklist), `CompareView.jsx`,
`code/tests/test_compare_endpoint.py`.

**Demo.** In "Compare past runs" tick the 15-, 50- and 150-user runs, press
Compare.

**Teacher might ask.**
- *Why limit it to 4?* — More columns stop fitting on screen and become hard to
  read; four covers low/medium/high/extreme load.
- *Why is "up" sometimes green and sometimes red?* — Up is good for requests
  per second but bad for failures or latency, so the colour follows meaning.

---

## 8. Per-case comparison ("Changed with load")

**What it does.** Below the totals, a table shows each case's failure rate in
each run. Cases whose failure rate changes by 10 points or more are highlighted
at the top under **Changed with load**.

**Why it exists.** Most cases fail 100% at every load level, so the overall
failure rate barely moves. That hides the real finding: a few cases go from 0%
to about 60% only under heavy load.

**How it works.** For each case and run we compute failure % and request count.
Cells with fewer than 5 requests are a **low sample** (too few to trust); they
are faded and ignored. A case is "changed" if any two trusted cells differ by
10 points or more.

**Files.** `code/analysis/case_comparison.py`, `code/app.py`,
`CompareView.jsx`, `code/tests/test_case_comparison.py`.

**Demo.** Compare a 15-user and a 150-user mock run (30 s each). The three
`expiresInMins` cases (missing / null / zero) appear under "Changed with load";
the login cases don't.

**Teacher might ask.**
- *Why ignore cells with fewer than 5 requests?* — With 2 requests, one
  failure is already 50%; that's noise, not a finding.
- *Why did the tolerated cases start failing?* — They weren't rejected for being
  bad input; they were rate-limited (429) because the server got more requests
  than it allows per second.

---

## 9. Timeline charts

**What it does.** Three small charts on the same time axis: active users,
throughput (requests/s and failures/s), and response time (average and p95).
Hover to read the values at any second; there is also a data-table view.

**Why it exists.** Totals don't show *when* things went wrong. The timeline
shows the ramp-up and the moment the server starts to struggle.

**How it works.** Locust writes one summary row per second
(`stats_history.csv`). We store it; for split runs we add the workers' rows
for the same second together (and average the response times, weighted by
traffic). The charts are drawn as SVG (vector graphics) in plain React, with no chart
library.

**Files.** `code/load_test_runner.py`, `code/job_store.py`,
`code/stats_aggregator.py` (`merge_history_csvs`),
`code/frontend/src/components/Timeline.jsx`, `code/tests/test_history_merge.py`.

**Demo.** After a 150-user run, scroll to "Timeline": users climb to 150, and
failures/s rise to almost meet requests/s once rate limiting starts.

**Teacher might ask.**
- *Why three charts instead of one with two y-axes?* — Users and requests/s
  have different units; a two-axis chart lets you make lines look related or
  unrelated just by scaling. Separate charts sharing a time axis are honest.
- *Why does p95 move more than the average?* — Locust's average is a running
  average since the start, so it changes slowly; p95 is over the last few
  seconds, so it reacts quickly.

---

## 10. Custom edge cases

**What it does.** Add your own test case (a label + a JSON body). The system
checks it's a real edge case before adding it to the list.

**Why it exists.** Generated cases can't cover everything. For example, "log in
as admin" is a test only the tester would think of.

**How it works.** The backend compares your JSON with the sample field by
field: removed fields, nulls, type changes, value changes, added fields. It
rejects a case that is identical to the sample, isn't a JSON object, or has a
bad or already-used label. When you start the test, the backend checks every
custom case again (it never trusts the browser alone).

**Files.** `code/analysis/custom_cases.py`, `code/app.py`
(`/api/validate-custom-case`, `custom_cases` in `/api/confirm-selection`),
`App.jsx`, `code/tests/test_custom_cases.py`,
`code/tests/test_custom_case_endpoints.py`.

**Demo.** In section 3 open "Add your own case": label `admin_user`, body with
`"username": "admin"` → added with a [custom] tag. Try the sample unchanged →
"Not an edge case — identical to the sample". Try broken JSON → error.

**Teacher might ask.**
- *Why validate twice, in the browser and on the server?* — Anyone can send
  requests to the backend directly, bypassing the browser. The server must check
  for itself.
- *Why compare field by field instead of using `==`?* — Python says `30 == 30.0`
  and `1 == True`, but to an API those are different types. Our diff catches
  them.

---

## 11. Baseline and regression flags

**What it does.** Mark a completed run as the **baseline** (the known-good
reference) for its target. Later runs of the same target show "Compared with
baseline": cases whose failure rate rose by 10+ points, and how much p95
changed.

**Why it exists.** This is the core idea of **regression testing**: after a
change, automatically check that nothing got worse than before.

**How it works.** One run per target carries a baseline flag in the database.
When a run finishes, the frontend asks `/api/regressions/<id>`. The backend
compares it with the baseline using the same rules as the per-case comparison
(at least 5 requests on both sides).

**Files.** `code/analysis/regressions.py`, `code/job_store.py`, `code/app.py`,
`code/frontend/src/components/RunActions.jsx`, `App.jsx`,
`code/tests/test_regressions.py`, `code/tests/test_baseline_endpoints.py`.

**Demo.** Run 15 users for 30 s → "Mark as baseline". Run 150 users for 30 s → the
panel lists the three `expiresInMins` cases and the p95 change.

**Teacher might ask.**
- *Why only one baseline per target?* — Then "compared with the baseline" always
  has one clear meaning; marking a new one replaces the old.
- *What counts as "the same target"?* — The stored target, which is the host
  (e.g. `http://127.0.0.1:8000`).

---

## 12. Downloadable report

**What it does.** "Download report (.md)" saves a Markdown file with the
target, settings, summary, failure types, per-case table, baseline comparison
and the time it was made.

**Why it exists.** Results need to be shared or attached to a bug report, not
just looked at on screen.

**How it works.** The browser builds the text from data it already has and
saves it with a **Blob** (an in-memory file) and a temporary download link.
The backend isn't involved.

**Files.** `code/frontend/src/utils/report.js`, `RunActions.jsx`.

**Demo.** After any completed run, click "Download report (.md)" and open the
file.

**Teacher might ask.**
- *Why Markdown?* — It's readable as plain text and renders nicely on GitHub
  and GitLab.
- *Why build it in the browser?* — Everything needed is already on the page, so
  no new server code is needed.

---

## 13. Summary of results and key figures

**What it does.** At the top of every completed result, a "Summary of results"
gives two to four numbered sentences saying what happened, for example "2 cases
caused server errors (500) on 95 requests", "Rate limiting (429) on 1,963
requests across 27 cases" or "3 cases got worse than the baseline run". Each
sentence starts with a small square in its status colour. Below it, a row of
key figures (requests, failure rate with "285 of 327" underneath, average and
p95 response, requests per second, duration) is separated by thin vertical
dividers; on a phone the row becomes two columns.

**Why it exists.** A results page full of numbers takes time to read. The
findings give the conclusion first, so a viewer knows what to look for.

**How it works.** A small pure function (one with no side effects: same input,
same output) reads data the page already has — the failure types, the per-case
rows and the baseline comparison — and turns it into sentences, most serious
first. No backend change.

**Files.** `code/frontend/src/utils/findings.js`,
`code/frontend/src/components/Findings.jsx`, `JobResultSummary.jsx` (the
key-figure row), `code/frontend/src/index.css` (`.stat-row`: the dividers and
the two-column phone layout).

**Demo.** Finish a 150-user mock run after marking a 15-user run as the
baseline: the findings list server errors, the regressions, rate limiting and
rejected input.

**Teacher might ask.**
- *Where do these sentences come from — is it AI?* — No. They are built by
  fixed rules from numbers the backend already returned, so they are always
  consistent with the tables below.
- *Why at most four?* — More than four stops being a summary.

---

## 14. Outcome strips

**What it does.** A coloured bar shows how requests ended: green passed, amber
rejected (4xx), blue rate limited (429), red server error (5xx), grey
connection failure. There is one large strip for the whole run, a small one in
every row of the results table, and one per run in the comparison.

**Why it exists.** It makes the main finding visible at a glance: at 150 users
the tolerated `expiresInMins` cases turn from all green to green plus blue,
because rate limiting starts.

**How it works.** The failure types already say, for each case, how many
requests failed with which status. Whatever didn't fail counts as passed. The
bar's segment widths are proportional to those counts.

**Files.** `code/frontend/src/utils/outcomes.js`,
`code/frontend/src/components/OutcomeStrip.jsx`, `JobResultSummary.jsx`,
`CompareView.jsx`, `code/frontend/src/theme.js` (the `outcome` colours).

**Demo.** Scroll the results table of a 150-user run: credential cases are
amber and blue, the three `expiresInMins` cases green and blue, and the two
crashing cases red and blue.

**Teacher might ask.**
- *Why these colours?* — Each colour means exactly one outcome everywhere in
  the app, and is never used for decoration, so the reader learns it once.
- *Is colour the only signal?* — No. Every strip has a text description for
  screen readers, a tooltip, and the large one has a legend with counts.

---

## 15. Backend connection indicator

**What it does.** The header shows "Connected" (green) or "Backend offline"
(red).

**Why it exists.** If the backend isn't running, nothing works. The indicator
says so immediately instead of letting the user find out from an error.

**How it works.** Every 15 seconds the page calls the existing `GET
/api/health` endpoint. An answer means connected; no answer means offline.

**Files.** `code/frontend/src/components/AppHeader.jsx`.

**Demo.** Stop `python app.py`; within 15 seconds the header says "Backend
offline". Start it again and it returns to "Connected".

**Teacher might ask.**
- *Why 15 seconds and not every second?* — It is only a status light; checking
  often would add load for no benefit.
- *Does it change how tests run?* — No, it only reads the health endpoint.

---

## 16. Visual design and step rail

**What it does.** A consistent dark "measurement instrument" look: graphite
panels, one teal accent for actions, status colours only for meaning, a
monospace font for every number. The left step rail shows each step's state
(done, current, waiting, not needed) and scrolls to it when clicked.

**Why it exists.** A consistent visual language makes the tool feel like real
engineering software and makes the results easier to read.

**How it works.** All colours, fonts, sizes, spacing and motion timings are
design tokens (named values) in one file, `theme.js`; components only use those
names. At start-up `main.jsx` publishes the same tokens as CSS variables, so
the stylesheet uses them too and contains no colour values of its own. Buttons
and clickable rows are styled by CSS classes (`btn`, `btn-primary`, `toggle`,
`row-interactive` …) because only CSS can give them hover, pressed and
disabled states. There are five text sizes and one 4px spacing scale. Motion
is limited to short feedback and the progress bar, which moves with
`transform` rather than resizing. The fonts are stored in the project
(`public/fonts`), so the app works without internet. The step rail used to
live inside `App.jsx`; it is now its own component.

**Files.** `code/frontend/src/theme.js` (tokens and `applyTheme`),
`code/frontend/src/main.jsx` (calls `applyTheme`),
`code/frontend/src/index.css` (fonts, button and row states, layout,
scrollbars, reduced motion), `code/frontend/public/fonts/`,
`code/frontend/src/components/Section.jsx` (step panels and shared input and
table styles; button styles moved to `index.css`),
`code/frontend/src/components/StepRail.jsx` (moved out of `App.jsx`), `App.jsx`.

**Demo.** Watch the rail while doing the workflow: each step goes from
"Current step" to "Done"; for a website target, steps 2 and 3 show "Not
needed". Narrow the window: the rail becomes a bar at the top.

**Teacher might ask.**
- *Why keep all colours in one file?* — Changing the look means editing one
  file, and it guarantees that, for example, "red" always means the same thing.
- *Is it accessible?* — Every input has a label, everything works with the
  keyboard, focus is always visible, and animations are switched off for
  people who ask their system for reduced motion.

---

## 17. Problem rate

**What it does.** A second headline number next to the failure rate:
"Problem rate" = (server errors 5xx + rate limiting 429 + connection failures)
÷ all requests. It also appears in the comparison table and the report.

**Why it exists.** Our evaluation listed this limitation: the failure rate
counts *every* non-2xx answer as a failure, including the 400s a correct API
*should* return for invalid edge cases. A well-behaved API therefore showed an
alarming "89% failure rate". The problem rate counts only answers that point
at a real problem.

**How it works.** The backend already groups failures by type (feature 2).
A small function adds up the server-error, rate-limited and connection groups
and divides by the total request count from the stats file. It is added to
every status and compare response as `problem_count` and `problem_rate`; the
failure rate is unchanged.

**Files.** `code/analysis/problem_rate.py`, `code/app.py`
(`_with_failure_summary`), `JobResultSummary.jsx`, `CompareView.jsx`,
`utils/report.js`, `code/tests/test_problem_rate.py`.

**Demo.** Run the mock target with 15 users for 15 s: Failure rate ≈ 88%,
Problem rate ≈ 10% (only the 500s). Hover the Problem rate for the
explanation.

**Teacher might ask.**
- *Why not just change the failure rate?* — Other features (comparison,
  baseline regressions, reports) rely on it and it is the standard Locust
  number; adding a second number is safer and shows both views.
- *Why count 429 as a problem?* — The request itself was fine; the server
  refused it because of load, which is exactly what a load test looks for.

---

## 18. Stop a running test

**What it does.** A "Stop test" button beside the progress bar, with a
confirm step ("Stop now? Results so far are kept."). The run ends as
**cancelled**; if Locust had already written results, they are kept and
labelled "Cancelled — partial results".

**Why it exists.** Listed limitation (UX review U13): a mistaken 300-second
run could not be stopped and blocked every other test.

**How it works.** The backend now starts Locust with `subprocess.Popen`
(same command, output capture and timeout as before) and keeps each running
process in a dictionary by job id. `POST /api/cancel/<id>` terminates that
process — or every child process of a split run, or the current repeat of a
series — and the runner then stores status `cancelled` with whatever CSV files
Locust had written (it rewrites them every few seconds). In queue (SQS) mode it
returns 409, because the worker runs on another machine.

**Files.** `code/load_test_runner.py` (`cancel_run`, `_run_locust`),
`code/job_store.py`, `code/app.py`, `App.jsx`, `JobResultSummary.jsx`,
`CompareView.jsx`, `utils/report.js`, `code/tests/test_cancel.py`.

**Demo.** Start a 30 s run, click "Stop test" → "Yes, stop" after 10 s. Within
a second the status is "Cancelled" and about a third of the requests are
shown as partial results. The run appears as "cancelled" in the history.

**Teacher might ask.**
- *Why `Popen` instead of `subprocess.run`?* — `run` waits until the process
  ends and never gives us a handle to it; `Popen` returns the process object,
  so another request can call `terminate()` on it.
- *What happens to a split run?* — Every child is stopped; the group becomes
  "cancelled" once all children have stopped, and their partial results are
  merged exactly like a finished split run.

---

## 19. Lost connection while polling

**What it does.** If the backend stops answering during a run, a banner says
"Lost connection to the backend — retrying" and the app keeps checking every
2 seconds. When the backend answers again the banner disappears. After about
30 seconds (15 failed checks) it shows "Status unknown — the backend is
unreachable" with a "Check again" button.

**Why it exists.** Listed limitation (UX review U17): one failed status check
silently stopped the polling, so the page said "Running" forever.

**How it works.** Error handling was added *inside* `pollStatus()` only: a
`try/catch` around the status request, a counter of consecutive failures, and
a small `pollState` value (`retrying` or `lost`) that drives the banner. The
2-second interval and the completion check are unchanged. The double-start
guard is released only in the final "lost" state.

**Files.** `code/frontend/src/App.jsx`.

**Demo.** Start a 30 s run and stop the backend (Ctrl+C): the retrying banner
appears; after ~30 s, "Status unknown" and "Check again". (Restarting the
backend loses that run, because runs live in the backend process.)

**Teacher might ask.**
- *Why 15 attempts?* — 15 × 2 s ≈ 30 s: long enough to survive a backend
  restart or a short network blip, short enough not to leave the user waiting.
- *Why release the guard only at the end?* — While retrying, the run may still
  be going; starting a second one would make two polling loops overwrite each
  other.

---

## 20. Request headers (authenticated APIs)

**What it does.** Step 2 has an optional "Request headers" editor (name/value
rows, Add / Remove), e.g. `Authorization: Bearer <token>`. The headers are
sent with the Analyze probe and with every request Locust makes, for API and
website tests, single and split runs.

**Why it exists.** Most real APIs need a token; without headers every request
got 401 and the tool could only test public endpoints.

**How it works.** The browser sends the headers with the start request. The
backend checks them (valid names, single-line values) and hands the values to
Locust **only through an environment variable**, which both locustfiles read.
Values are never written to the database, a file or a log, and never sent
back: only the header *names* are stored with the run, and anything Locust
prints is passed through a redaction step. Values are typed into password
fields, so they are masked on screen. In SQS mode headers are refused, since
the queue would store them. The mock target can require a token with
`MOCK_REQUIRE_TOKEN=demo-token`.

**Files.** `code/analysis/request_headers.py`, `code/analysis/sanity_check.py`,
`code/app.py`, `code/load_test_runner.py`, `code/job_store.py`
(`header_names` column), both files in `code/locust_tests/`,
`code/scripts/mock_target.py`, `code/scripts/README.md`,
`components/RequestHeadersEditor.jsx`, `App.jsx`, `utils/report.js`,
`code/analysis/failure_summary.py` and `utils/findings.js` (401/403 explained
as "not authorised"), `code/tests/test_request_headers.py`.

**Demo.** Start the mock with `MOCK_REQUIRE_TOKEN=demo-token`. Run 15 users
for 10 s: every request is a 401 ("refused as not authorised; check the
request headers"). Add `Authorization` = `Bearer demo-token` in step 2 and run
again: normal results, and "Sent with request headers: Authorization (values
hidden)".

**Teacher might ask.**
- *How do you know the token is not stored?* — The tests start runs with a
  secret header and then search the whole database dump, every result file and
  every API response for it; a real run was checked the same way, including
  the server logs.
- *Why an environment variable and not a file, like the cases?* — A file
  would put the secret on disk and would have to be deleted reliably even when
  a run crashes; an environment variable only exists in the Locust process's
  memory and disappears with it.

---

## 21. CI regression gate

**What it does.** `scripts/regression_gate.py` is a command-line check for a
CI pipeline: it starts a load test through the normal API, waits for it,
compares it with the baseline and exits **0** (no regressions), **1**
(regressions) or **2** (error). An example GitLab job runs it manually.

**Why it exists.** Regression detection (feature 11) only helped someone who
opened the app. A pipeline needs a yes/no answer it can act on automatically.

**How it works.** The script generates and confirms all edge cases from a
sample file, starts the run, polls the status, then calls
`/api/regressions/<run>` (optionally `?baseline_id=<id>`, a new additive
parameter) and prints a short summary. The decision is a pure function of
that response, so it is tested without a network. The CI job is
`when: manual` and `allow_failure: true`, so it never runs or blocks anything
by itself.

**Files.** `code/scripts/regression_gate.py`, `code/scripts/gate_sample.json`,
`code/scripts/README.md`, `code/.gitlab-ci.yml`, `code/app.py`
(`baseline_id` parameter), `code/tests/test_regression_gate.py`.

**Demo.** Mark a 15-user run as baseline in the app, then in `code/`:
`python scripts/regression_gate.py --api http://localhost:5000 --url
http://127.0.0.1:8000/api/login --sample scripts/gate_sample.json --users 150
--duration 15` → "FAIL: 3 case(s) got worse…", and `echo $?` (or
`$LASTEXITCODE` in PowerShell) prints 1. With `--users 15` it prints PASS and
exits 0.

**Teacher might ask.**
- *Why exit codes?* — Every CI system treats exit code 0 as success and
  anything else as failure; that is the universal way for a script to pass or
  fail a pipeline step.
- *Why is the CI job manual?* — A load test needs a running backend and a
  target we own, and it puts real load on it; it should never fire on every
  commit without someone deciding to.

---

## 22. Repeated runs (series)

**What it does.** "Repeat" (1–5) in the load settings runs the same test that
many times back to back. When they finish, a series summary shows, for the
whole run, the mean ± standard deviation of throughput, p95 and problem rate,
and for each case its mean failure rate and min–max across repeats.

**Why it exists.** One load test is one sample: run it again and the numbers
move. Without repeats we could not tell whether a difference between two runs
was real or just noise.

**How it works.** The backend stores a *series* (its settings and the ids of
its runs) and a background thread starts one ordinary run (single or split),
waits for it to finish, and starts the next. Each repeat is a normal run, so
history, comparison and baselines work on it unchanged. The series id is
polled through the usual status endpoint; a pure function computes the
statistics. Stop cancels the current repeat and starts no more; a series
counts as one running test for the double-start guard.

**Files.** `code/analysis/series_stats.py`, `code/load_test_runner.py`
(`start_series`, `_run_series`), `code/job_store.py` (`series` table),
`code/app.py`, `LoadTestConfig.jsx`, `components/SeriesSummary.jsx`,
`App.jsx`, `code/tests/test_series_stats.py`, `code/tests/test_series.py`.

**Demo.** Mock target, 15 users, 10 s, Repeat 3 → after ~45 s: throughput
≈ 12.2 ± 0.3 req/s, p95 ≈ 153 ± 6 ms, and a per-case table where the
`expiresInMins` cases show their min–max spread.

**Teacher might ask.**
- *Why the sample standard deviation (n − 1)?* — Three repeats are a sample
  of all the runs we could have done; dividing by n − 1 corrects the
  tendency of a small sample to underestimate the spread.
- *Why one after another instead of in parallel?* — Parallel repeats would
  load the server together and change the result; the point is to repeat the
  *same* conditions.

---

## Job states

Every run (a single job, a split group, or a repeat series) moves through
these states. The last four are **terminal**: the run never changes again, and
the browser stops polling.

```
queued ──► running ──► completed
   │          ├──────► failed      (Locust could not run, or an error)
   │          ├──────► timeout     (ran longer than duration + 60 s)
   └──────────┴──────► cancelled   (Stop test; partial results kept if any)
```

- A **split group** is `cancelled` once every child has stopped and at least
  one was cancelled; `failed` and `timeout` in any child take priority, and it
  is `running` while any child still runs.
- A **series** is `completed` only if every repeat completed; a repeat that
  failed or timed out makes it `failed`; Stop makes it `cancelled`.
- Only `completed` runs can become the baseline.
