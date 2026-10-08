# Elevate Load Tester

UCS503 Software Engineering Project (2026–27 ODD) · TIET Patiala

A web application that load-tests HTTP targets: analyze a URL, classify it as
an API or a website, generate edge-case payloads or crawl sitemap paths, run
an asynchronous Locust-based load test, and compare past runs.

**Team Elevate:** Vivek Pandey · Anant Agrawal · Piyush Singh

## Features

- Analyze a URL and classify it as an API or a website
- Auto-generated edge cases (missing field, null, wrong type, boundary
  values, SQL injection / XSS) plus your own validated custom cases
- Asynchronous Locust load tests; runs above 50 users are split across
  workers and merged
- Results with failure rate, average and p95 response time, sortable and
  grouped per-case tables, and failures grouped by type (rejected / rate
  limited / server error / connection)
- Timeline charts of users, throughput and response time over the run
- Compare 2–4 runs, with a per-case table that highlights cases that
  changed with load
- Baseline runs with automatic regression flags, and a downloadable
  Markdown report
- A local mock login API for repeatable, offline testing

Each feature is explained in plain English in
[docs/features.md](docs/features.md).

## Repo layout

| Path | Contents |
|------|----------|
| `code/` | Application source — Flask backend, React/Vite frontend, k8s manifests, GitLab CI. See [code/README.md](code/README.md) for setup. |
| `docs/` | Project documentation (built with mkdocs, published via GitHub Actions). |
| `journals/` | Per-member project journals, one folder per team member. |
| `project-report-prototype-stage/` | LaTeX project report (prototype stage). |
| `assets/` | Shared assets (logos etc.). |

## Quick start

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

Full run instructions (including the optional SQS queue mode) are in
[code/RUNBOOK.md](code/RUNBOOK.md), and the documentation lives in
[docs/index.md](docs/index.md).
