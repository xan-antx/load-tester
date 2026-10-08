# Dev scripts

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

Every request also waits a random 50–150 ms so response times look realistic. Change
the rate limit with the `MOCK_RATE_LIMIT` environment variable, e.g. in PowerShell
`$env:MOCK_RATE_LIMIT="80"` before starting it.
