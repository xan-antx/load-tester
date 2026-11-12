# Dev scripts

| Script | What it is |
|--------|------------|
| `mock_target.py` | Local login API to test against (below) |
| `regression_gate.py` | Command-line regression gate for CI (below) |
| `check_extract_paths.py`, `check_sitemap_paths.py` | Manual smoke checks |

Manual smoke-check scripts, **not** automated tests — they fire live HTTP requests
and require the backend running on `localhost:5000`. Run them directly with
`python check_extract_paths.py` / `python check_sitemap_paths.py`.

## Mock target (`mock_target.py`)

A small local login API to load-test instead of a public website. Results are
repeatable, it needs no internet, and it doubles as an offline fallback for demos.

Run it from `code/` (uses the same Flask install as the backend):

```
python scripts/mock_target.py
```

It listens on `http://127.0.0.1:8000/api/login`. In the app, analyze that URL and use
this sample input:

```
{"username": "demo", "password": "demo123", "expiresInMins": 30}
```

Valid credentials: **demo / demo123**.

Deliberate behaviours:

| Input | Response |
|-------|----------|
| username or password missing, null, empty, or not a string | 400 |
| wrong username/password | 400 |
| `expiresInMins` missing, null, or 0 | 200 (a default of 60 is used) |
| `expiresInMins` negative | 400 |
| `expiresInMins` not an integer, or above 1,000,000 | 500 — an unhandled exception, modelling a server that never validated this field |
| more than `MOCK_RATE_LIMIT` requests in one second (default 40) | 429 for any request, valid or not |
| **username longer than 256 characters** | **200 — a deliberate validation bug** (see below) |
| more requests than `MOCK_WORKERS` (default 8) can serve, about 80/s | they queue, so response times climb with load: the breaking point of a capacity run |

### The deliberate validation bug

A username longer than 256 characters is never length-checked and skips the
credential check, so the request is **accepted with 200**. The generated case
`very_long_string_username` (5,000 characters) expects a 4xx rejection, so the
load tester reports it under **"Accepted invalid input"**: a real-looking
validation bug for the demo. (`missing_expiresInMins` and `null_expiresInMins`
are also accepted, but there the mock is right: the field is optional. Switch
those two cases to "expects 2xx" in step 3 to leave only the real bug.)

Every request also waits a random 50–150 ms so response times look realistic. Change
the rate limit with the `MOCK_RATE_LIMIT` environment variable, e.g. in PowerShell
`$env:MOCK_RATE_LIMIT="80"` before starting it.

### Requiring a token (`MOCK_REQUIRE_TOKEN`)

To try the app's **Request headers** feature against an API that needs
authentication, start the mock with a token:

```
$env:MOCK_REQUIRE_TOKEN="demo-token"      # PowerShell
MOCK_REQUIRE_TOKEN=demo-token python scripts/mock_target.py   # bash
```

Every request must then carry `Authorization: Bearer demo-token`; anything else
gets **401** before any other rule is applied. Leave the variable unset (the
default) and no token is needed. The startup line says "bearer token required"
when it is on, without printing the token.

In the app: analyze the URL, open **Request headers** in step 2, add
`Authorization` = `Bearer demo-token`, then generate cases and run. Without the
header every request is a 401; with it, the run behaves exactly as without the
token.

## Regression gate (`regression_gate.py`)

A command-line check a CI pipeline can run after a deployment: it load-tests an
endpoint through the backend's normal API and **fails the job if the run got
worse than its baseline**. It uses only the standard library and `requests`.

```
python scripts/regression_gate.py --api http://localhost:5000 \
    --url http://127.0.0.1:8000/api/login --sample scripts/gate_sample.json \
    --users 50 --duration 30 --i-own-target [--baseline-id <run id>] [--header "Authorization: Bearer x"]
```

What it does, in order:

1. Reads the sample JSON body (`gate_sample.json` is the mock's sample).
2. Generates every edge case, confirms them all, and starts the run
   (`--users`, `--duration`, `--spawn-rate`, default 10/s). Above 50 users the
   run is split into parallel Locust processes on the same host, as usual.
3. Polls the run every 2 s until it finishes (gives up after `--timeout`,
   default duration + 300 s).
4. Asks `/api/regressions/<run>` how it compares with the baseline: the run
   given by `--baseline-id`, otherwise the run marked as the baseline for that
   target in the app.
5. Prints a short summary and exits:

| Exit code | Meaning |
|-----------|---------|
| 0 | No case's failure rate rose by 10+ points against the baseline |
| 1 | At least one case regressed (listed in the output) |
| 2 | Error: bad arguments, backend unreachable, run did not complete, unknown `--baseline-id`, or no baseline for the target |

Example output against the mock (baseline: a 15-user run; this run: 150 users):

```
Started run e48c34d5-…: 150 users for 15 s against http://127.0.0.1:8000/api/login
Baseline: run 4bab7a41-… (15 users)
p95 response: 160 ms -> 166 ms (+3.8%)
FAIL: 3 case(s) got worse by 10.0 points or more:
  null_expiresInMins: 0.0% -> 61.5% (+61.5 pts)
  ...
```

Before using it, mark a good run as the baseline in the app (step 4, "Mark as
baseline"), or pass its id with `--baseline-id`.

**In GitLab CI** the `regression-gate` job in `code/.gitlab-ci.yml` is an example
only. It is `when: manual` (it runs only when someone presses play on the
pipeline page) and `allow_failure: true` (its result never blocks build or
deploy). Set the CI/CD variables `GATE_API_URL` and `GATE_TARGET_URL`, and
optionally `GATE_BASELINE_ID`, before running it. Never point it at a server
you don't own.
