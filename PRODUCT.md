# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: developers and QA engineers** load-testing an HTTP API or website
  they own, before a release or as a CI gate. Their job is to find out whether
  the target handles bad input correctly, stays within its performance targets,
  and how much load it can take. They should not have to write a load-test
  script to get there.
- **Second audience: course evaluators** (UCS503 Software Engineering, TIET
  Patiala) watching live demos, often on a projector. They judge whether the
  system works and whether its results can be trusted. They may not know
  load-testing terms.

## Product Purpose

Elevate Load Tester takes a target URL, classifies it as an API or a website,
and generates edge-case payloads (APIs) or crawls sitemap paths (websites). It
runs an asynchronous Locust-based load test and returns a judgement on the
target, where raw tools only return numbers.

Success means a user who brings only a URL and a sample request body leaves
knowing:

- which inputs the API mishandles;
- whether every case was actually tested;
- whether the target meets its SLOs;
- the maximum load it sustains.

The answer should be correct, and the user should trust it.

## Positioning

**A clear verdict, not raw numbers.** From a URL and a sample body, with no
scripting, it reports:

- the validation bugs found by expected-outcome edge cases. Each case says
  whether it should be accepted (2xx) or rejected (4xx), so a correct rejection
  is not counted as a bug;
- whether every case was really exercised;
- a PASS/FAIL verdict against the user's SLOs;
- the capacity limit and breaking point.

Locust on its own produces CSVs; this product interprets them.

Ordering rule: **findings come before the SLO verdict, and a run with bugs or
untested cases never looks all-green.**

## Operating Context

- **Workflow:** 1 Target → 2 Sample request (APIs only) → 3 Cases and load →
  4 Run and results → 5 Compare runs. Websites skip steps 2–3.
- **Usage scene:** a laptop at a desk, and a laptop on a projector during
  evaluation demos.
- **Repeatable demos** use the bundled mock login API
  (`code/scripts/mock_target.py`). It has three deliberate bugs, a 40
  requests/s rate limit and a known capacity limit, so the expected correct
  output is known in advance.
- **One-command stack:** `docker compose up --build`, then
  http://localhost:8080, pre-filled to test the mock target.
- **Outside the browser:** a CLI (`code/cli.py`) and a GitHub Actions
  performance gate use the same SLO verdict, with exit codes 0 (pass),
  1 (fail) and 2 (error).
- **Other outputs:** downloadable Markdown reports, saved baselines with
  regression flags, and comparison of 2–4 runs.

## Capabilities and Constraints

**Capabilities**

- API/website classification
- Generated and custom edge cases, each with an expected outcome
- SLO thresholds such as p95 latency and server-error rate
- Capacity finder (step load)
- Repeated runs (1–5) shown as mean ± SD
- Stopping a run while keeping partial results
- Request headers for authenticated APIs; values are never stored
- Timelines, failures grouped by type, comparison and baselines
- Runs above 50 users split into parallel Locust processes on one host

**Safety guardrails**

- Private, internal and cloud-metadata targets are refused when deployed.
- An "I own this target" confirmation is required before every load test.
- Only one active run at a time by default (`MAX_ACTIVE_RUNS`).

**Terminology** to keep consistent everywhere:

- Request outcomes: Passed; Accepted invalid input; Rejected valid input;
  Rejected (4xx); Rate limited (429); Server error (5xx); Connection failure.
- p95: the merged p95 of a split run is approximate and is always marked ≈.
- Other terms: SLO, capacity, split run, baseline.

**Binding constraints for the UI revamp and all later work**

- **Frontend only.** Backend API contracts stay unchanged.
- **No heavy new dependencies.** The frontend is React + Vite and has no UI
  libraries today.
- **Works fully offline.** Fonts and assets are self-hosted, and the page makes
  no external requests.
- **Desktop and laptop first.** Phone use is not a goal.
- **Readable on a projector.** Headline numbers and verdicts are large, and
  nothing important is set in low-contrast grey or tiny text.

**Known limitations to state honestly, not hide**

- Target safety is checked only when a test starts; DNS changes or redirects
  during a run are not re-checked.
- A split run is several processes on one host, not a distributed test.
- The SQS worker mode is future work.

## Brand Commitments

- **Name:** Elevate Load Tester.
- **Team:** Team Elevate (Vivek Pandey, Anant Agrawal, Piyush Singh).
- **Course context:** UCS503 Software Engineering Project, 2026–27 ODD
  semester, TIET Patiala. The TIET logo appears in `assets/tiet-logo.svg` and
  is used in the documentation.
- **Voice:** plain English for non-experts. Jargon is explained where it
  appears (p95, spawn rate, 429). Results read as sentences, such as "22 cases
  were rejected as invalid input (400)". Outcomes are named the way people talk
  about them.

## Evidence on Hand

- **Measured results** from real runs against the mock target on
  12 November 2026, in `docs/evaluation.md`. No figures there are estimates.
- **Plain-English explanation** of every feature, with demo steps, in
  `docs/features.md`.
- **UX and accessibility review** of the earlier design (9 October 2026), in
  `docs/ux-review.md`. It records Nielsen-heuristic and WCAG issues by id
  (U1, A1 …).
- **Screenshots of the earlier UI** in `assets/frontend/`.
- **356 automated tests** and a CI performance gate in `.github/workflows/`.
- **Absent:** there are no real external users, customers, testimonials,
  usage numbers, pricing or production deployments. Never fabricate any of
  these.

## Product Principles

1. **Judge, don't just measure.** Every run ends with a judgement the user can
   act on. Raw numbers support the verdict and never replace it.
2. **Honest severity.** Bugs and untested cases outrank a passing SLO. A
   correct rejection of bad input is never shown as a failure, and a flawed
   run never reads as success.
3. **Show what is approximate or incomplete.** Mark approximations (≈ p95),
   partial runs and skipped cases where the user reads the number.
4. **Explain in plain words.** Someone who does not know load testing should
   understand the outcome in a demo without a glossary.
5. **Safe by default.** Test only targets the user owns, refuse internal
   addresses, and never store secrets.

## Accessibility & Inclusion

- **WCAG 2.2 AA** is the required standard. The existing UX review audits
  against it.
- **Projector legibility** (see the constraints above) is an extra
  product-specific requirement.
- **Colour:** status colours carry meaning, so every outcome must also be named
  in text and must not rely on colour alone.
