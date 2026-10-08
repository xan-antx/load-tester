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

## 13. Findings summary

**What it does.** At the top of every completed result, two to four plain
sentences say what happened, for example "2 cases caused server errors (500)
on 95 requests", "Rate limiting (429) on 1,963 requests across 27 cases" or
"3 cases got worse than the baseline run". Each sentence has a coloured marker
that matches its status colour.

**Why it exists.** A results page full of numbers takes time to read. The
findings give the conclusion first, so a viewer knows what to look for.

**How it works.** A small pure function (one with no side effects: same input,
same output) reads data the page already has — the failure types, the per-case
rows and the baseline comparison — and turns it into sentences, most serious
first. No backend change.

**Files.** `code/frontend/src/utils/findings.js`,
`code/frontend/src/components/Findings.jsx`, `JobResultSummary.jsx`.

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

**How it works.** All colours, fonts and sizes are design tokens (named values)
in one file, `theme.js`; components only use those names. The fonts are stored
in the project (`public/fonts`), so the app works without internet. The step
rail used to live inside `App.jsx`; it is now its own component.

**Files.** `code/frontend/src/theme.js`, `code/frontend/src/index.css`,
`code/frontend/public/fonts/`, `code/frontend/src/components/Section.jsx`
(step panels and shared styles), `code/frontend/src/components/StepRail.jsx`
(moved out of `App.jsx`), `App.jsx`.

**Demo.** Watch the rail while doing the workflow: each step goes from
"Current step" to "Done"; for a website target, steps 2 and 3 show "Not
needed". Narrow the window: the rail becomes a bar at the top.

**Teacher might ask.**
- *Why keep all colours in one file?* — Changing the look means editing one
  file, and it guarantees that, for example, "red" always means the same thing.
- *Is it accessible?* — Every input has a label, everything works with the
  keyboard, focus is always visible, and animations are switched off for
  people who ask their system for reduced motion.
