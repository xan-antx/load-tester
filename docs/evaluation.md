# Evaluation: how we know it works

This page explains how we measure that Elevate Load Tester does its job, and
reports the numbers from real runs. Every figure here comes from a run made
while building the features (12 November 2026). None of them are estimates.

The runs used the bundled **mock target** (`code/scripts/mock_target.py`), a
small login API whose behaviour we control. Because we know exactly how it
*should* behave, we can check whether the tool reports the right things.

## 1. What a correct run looks like on the mock target

The mock is built with known properties:

- **Correct handling.** Valid credentials (`demo` / `demo123`) give 200.
  Missing, null, empty or wrong-type usernames and passwords, wrong
  credentials and a negative `expiresInMins` give 400.
- **Optional field.** `expiresInMins` is optional: missing, null or 0 is
  accepted.
- **Three deliberate bugs:**
  1. `expiresInMins` as text: unhandled exception, **500**;
  2. `expiresInMins` above 1,000,000: unhandled exception, **500**;
  3. a username longer than 256 characters: **accepted with 200**, a
     validation bug.
- **Load limits.** A global rate limit of 40 requests/s (beyond it, 429), and 8
  workers that each spend 50–150 ms per request (about 80 requests/s). Beyond
  that, requests queue and latency climbs.

A correct tool should therefore:

- find exactly the three bugs and report nothing else as wrong;
- report a 429 as rate limiting, not as a bug;
- put the capacity limit near the point where the mock runs out of workers.

## 2. Expected vs actual edge-case outcomes

**Run:** the docker compose stack, all 27 generated cases, 15 users for 30 s.
`missing_expiresInMins` and `null_expiresInMins` were set to "expects 2xx",
because the field is optional.

| Result | Value |
|---|---|
| Requests | 337 |
| Handled correctly | **305 (90.5%)** |
| Accepted invalid input | 11 requests, **1 case**: `very_long_string_username` |
| Server errors (500) | 21 requests, **2 cases**: `wrong_type_expiresInMins`, `very_large_expiresInMins` |
| Rejected valid input | 0 |
| Rate limited (429) | 0 (about 11 requests/s, under the 40/s limit) |
| p95 / average | 150 ms / 107 ms |

Per case:

| Case | Expects | Requests | Handled correctly | What went wrong |
|---|---|---|---|---|
| valid_sample | 2xx | 9 | 9 | — |
| missing_username | 4xx | 15 | 15 | — |
| null_username | 4xx | 14 | 14 | — |
| wrong_type_username | 4xx | 16 | 16 | — |
| empty_string_username | 4xx | 11 | 11 | — |
| **very_long_string_username** | 4xx | 11 | **0** | **accepted invalid input (200) ×11** — the deliberate validation bug |
| sqli_username_0 / 1 / 2 | 4xx | 8 / 14 / 17 | all | — |
| xss_username_0 / 1 | 4xx | 9 / 11 | all | — |
| missing_password | 4xx | 5 | 5 | — |
| null_password | 4xx | 13 | 13 | — |
| wrong_type_password | 4xx | 12 | 12 | — |
| empty_string_password | 4xx | 17 | 17 | — |
| very_long_string_password | 4xx | 15 | 15 | — |
| sqli_password_0 / 1 / 2 | 4xx | 18 / 10 / 17 | all | — |
| xss_password_0 / 1 | 4xx | 14 / 10 | all | — |
| missing_expiresInMins | 2xx | 15 | 15 | — |
| null_expiresInMins | 2xx | 10 | 10 | — |
| **wrong_type_expiresInMins** | 4xx | 12 | **0** | **server error (500) ×12** — deliberate bug |
| **very_large_expiresInMins** | 4xx | 9 | **0** | **server error (500) ×9** — deliberate bug |
| negative_expiresInMins | 4xx | 11 | 11 | — |
| zero_expiresInMins | 2xx | 14 | 14 | — |

**Verdict:** all 3 deliberate bugs were caught, and all 24 other cases were
handled correctly, so there were no false findings. Before expected outcomes
(feature 24), the same mock showed an "89% failure rate", because every
correct 400 counted as a failure.

**With default expectations.** The two optional-field cases are flagged as
"accepted invalid input" too: 20 of 166 requests in a 15-user, 15-second run.
That is the right call for a tool that cannot know which fields are optional,
and the per-case "expects 2xx" toggle exists for exactly this.

**Split run.** At 120 users, run as 3 parallel Locust processes on the same host (12 s, optional-field cases
switched to "expects 2xx"), the merged result still showed only
`very_long_string_username` as accepted invalid input (20 requests):

- 38 server errors (500), from the two crash cases;
- 497 rate-limited (429), correctly kept separate.

## 3. SLO thresholds

Default SLO in the app: **p95 ≤ 500 ms** and **server errors (5xx + no answer)
≤ 1%**. Three more thresholds are optional: average response time,
unexpected-answer rate and minimum throughput.

| Run | p95 | Server errors | Unexpected answers | Verdict |
|---|---|---|---|---|
| Evaluation run above (SLO also had unexpected ≤ 5%) | 150 ms ✓ | 6.23% ✗ | 3.26% ✓ | **FAIL** |
| Browser run, 15 users × 15 s, all cases | 150 ms ✓ | 9.04% ✗ | — | **FAIL** |
| CI gate config (known bugs excluded), local | 160 ms ✓ | 0.0% ✓ | 0.0% ✓ | **PASS** |

The failures are correct: the mock really does crash on two inputs. The SLO
turns that into a clear FAIL rather than a number the reader has to judge.

## 4. Capacity on the mock target

**Settings:** only `valid_sample` selected; start 20 users, add 20 per step,
12 s per step, up to 200; spawn rate 20/s; SLO p95 ≤ 500 ms and server
errors ≤ 1%; early stop on.

| Run | Max sustainable | Breaking point | Why it broke | Run time |
|---|---|---|---|---|
| API (local) | **120 users** | **140 users** | p95 550 ms > 500 ms | 89 s (early stop) |
| Browser UI (local) | 120 users | 140 users | p95 560 ms | ≈ 90 s |
| CLI (local) | 120 users | 140 users | p95 580 ms | ≈ 90 s |
| CLI (docker compose, gunicorn) | 120 users | 140 users | p95 530 ms | ≈ 90 s (exit 0) |

Steps of the first run:

| Users | Requests/s | p95 ms | 429 share | Verdict |
|---|---|---|---|---|
| 20 | 15.9 | 260 | 0% | PASS |
| 40 | 28.8 | 190 | 0% | PASS |
| 60 | 43.5 | 190 | 10% | PASS |
| 80 | 58.0 | 200 | 31% | PASS |
| 100 | 72.3 | 210 | 44% | PASS |
| 120 | 78.1 | 410 | 49% | PASS |
| 140 | 80.4 | **550** | 50% | **FAIL** |

This matches the mock's design. Throughput levels off at about 80 requests/s,
the 8 workers' limit, and p95 climbs once requests queue for a worker.
All four runs, in three environments, agree on 120 / 140 users. The step size (20 users) is the
resolution: the true limit lies between 120 and 140 users.

## 5. The CI performance gate

`.github/workflows/ci.yml` runs on every push and pull request to `main`. It
starts the mock target and the backend, and runs `cli.py` with
`code/loadtest.ci.yml`: 10 users for 25 s, the three known bugs excluded,
p95 ≤ 500 ms, server errors ≤ 1%, unexpected answers ≤ 1%.

| Where | Requests | Handled correctly | p95 | Verdict | Exit code |
|---|---|---|---|---|---|
| Windows, local backend | 174 | 100% | 160 ms | PASS | 0 |
| docker compose backend | 180 | 100% | 150 ms | PASS | 0 |
| Linux container, Python 3.12 (same steps as the CI job) | 184 | 100% | 150 ms | PASS | 0 |
| Example config (all cases, bugs included), local | 15 s run | — | 200 ms | **FAIL** (server errors 4.49%, unexpected 6.41%) | **1** |

The last row shows the gate failing when it should. The workflow writes the
verdict table into the job summary and uploads the report and JSON as
artifacts.

## 6. Automated tests

| Suite | Count | Where it ran |
|---|---|---|
| Backend pytest (no network, no server; Locust and HTTP faked) | **356 passed** | Windows (Python 3.14), from `code/` and from the repo root; Linux container (Python 3.12) |
| Frontend lint (ESLint) | 0 problems | local |
| Frontend production build | passes | local and in the frontend Docker image |

The tests were 160 before this round. The new ones cover:

- target guardrails, redirect re-checks, ownership and CORS (`test_target_guard.py`);
- expected outcomes and the mock's validation bug (`test_expectations.py`);
- SLO verdicts (`test_slo.py`);
- the capacity finder, on synthetic history data (`test_capacity.py`);
- the CLI, with mocked HTTP (`test_cli.py`);
- the robustness fixes (`test_robustness.py`): the server-side limit of one
  active run (429), failed Locust exits and missing statistics, runs
  interrupted by a restart, split-run status kept current, and the read-only
  HEAD → GET → OPTIONS probe.

## 7. Safety checks

| Check | Result |
|---|---|
| Analyze `http://169.254.169.254/latest` | 400 "cloud metadata address", locally and in compose |
| Start without `i_own_target: true` | 400 "Confirm that you own this target…" |
| Redirect to a metadata address during the probe | the redirect is not followed (unit test) |
| Private targets with `ALLOW_PRIVATE_TARGETS=false` | 400 for 10.x, 127.x, 169.254.x and others (unit tests) |
| Container user | gunicorn runs as `appuser` (uid 10001), one `gthread` worker |
| Stop a run under gunicorn | cancelled within seconds, partial results kept (22 requests) |

## Limitations of this evaluation

- **One machine.** The load generator and the target ran on the same laptop,
  so absolute latencies include its own load. The *shape* of the results (the
  bugs found, the plateau, the breaking point) is what is being checked.
- **The CI gate on GitHub's runners.** It is verified by running the same
  steps in a Linux container. The first real GitHub Actions run will confirm
  it on the hosted runners.
- **Approximate split-run p95.** It is a request-weighted average, not a
  true percentile (see the README).
