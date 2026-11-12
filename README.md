# Elevate Load Tester

[![CI](https://github.com/xan-antx/load-tester/actions/workflows/ci.yml/badge.svg)](https://github.com/xan-antx/load-tester/actions/workflows/ci.yml)

UCS503 Software Engineering Project (2026–27 ODD) · TIET Patiala

A web application that load-tests HTTP targets and tells you whether they
pass. It analyzes a URL, classifies it as an API or a website, generates
edge-case payloads or crawls sitemap paths, runs an asynchronous Locust-based
load test, judges the result against your service-level objectives (SLOs),
and can find the maximum load a target sustains.

**Team Elevate:** Vivek Pandey · Anant Agrawal · Piyush Singh

## Features

- **Target analysis:** classifies a URL as an API or a website, with safety
  checks that refuse private, internal and cloud-metadata addresses when
  deployed, and an ownership confirmation before any test runs
- **Expected-outcome edge cases:** auto-generated cases (missing field, null,
  wrong type, boundary values, SQL injection / XSS) plus validated custom
  cases. Each case says whether it should be accepted (2xx) or rejected
  (4xx), so results show real findings: invalid input accepted, valid input
  rejected, server errors, rate limiting
- **SLO pass/fail verdicts:** set thresholds such as p95 latency and
  server-error rate; every run ends with a PASS/FAIL verdict and a
  per-threshold checklist
- **Capacity finder:** step-load mode that increases users in stages and
  reports the maximum sustainable load and the breaking point
- **Results and comparison:** per-case tables, failures grouped by type,
  timeline charts, comparison of 2–4 runs, baselines with automatic
  regression flags, and a downloadable Markdown report
- **Large runs:** runs above 50 users execute as parallel Locust processes
  on the same host; merged p95 values are approximate and marked ≈
- **CLI and CI performance gate:** `code/cli.py` runs a test from a config
  file and exits non-zero when the SLO fails. GitHub Actions uses it to
  load-test the mock service on every push and pull request
- **Mock target:** a local login API with deliberate bugs, for repeatable,
  offline demos

Each feature is explained in plain English in
[docs/features.md](docs/features.md). How we measure that the product works
is in [docs/evaluation.md](docs/evaluation.md).

## Quick start (Docker)

``` shell
docker compose up --build
```

Then open http://localhost:8080. The app comes pre-filled to test the
bundled mock target.

## Quick start (from source)

``` shell
cd code
pip install -r requirements.txt
python app.py
```

Then in a second terminal:

``` shell
cd code/frontend
npm install
npm run dev
```

For an offline target, start the mock API in a third terminal
(`cd code`, then `python scripts/mock_target.py`).

## CLI

``` shell
cd code
python cli.py run --config loadtest.example.yml
```

Exit codes: `0` = SLO passed, `1` = SLO failed, `2` = error.

## Engineering details

- **Backend:** Flask served by gunicorn, Locust, SQLite job store
- **Frontend:** React + Vite
- **CI/CD:** GitHub Actions runs backend tests, frontend lint and build, and
  a performance gate against the mock target; images are pushed to GitHub
  Container Registry on `main`
- **Tests:** 356 automated tests
- **Deployment:** Docker image, Kubernetes manifests in `code/k8s/`
- **Server limits:** one active run at a time by default
  (`MAX_ACTIVE_RUNS`); runs interrupted by a restart are marked as such

## Known limitations

- Target safety checks run when a test starts; DNS changes or redirects
  during a run are not re-checked
- Large runs use parallel processes on one host, not separate machines, and
  their merged p95 is an approximation
- The SQS queue mode (`worker.py`, `Dockerfile.worker`) is not deployed and
  is future work

## Repo layout

| Path | Contents |
|------|----------|
| `code/` | Application source — Flask backend, React/Vite frontend, CLI, k8s manifests. See [code/README.md](code/README.md) for setup. |
| `.github/workflows/` | CI pipeline and docs deployment. |
| `docs/` | Project documentation (built with mkdocs, published via GitHub Actions). |
| `journals/` | Per-member project journals, one folder per team member. |
| `project-report-prototype-stage/` | LaTeX project report (prototype stage). |
| `assets/` | Shared assets (logos etc.). |
| `docker-compose.yml` | One-command local stack: app, API and mock target. |

Full run instructions are in [code/RUNBOOK.md](code/RUNBOOK.md), and the
documentation lives in [docs/index.md](docs/index.md).


