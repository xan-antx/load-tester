# Elevate Load Tester

UCS503 Software Engineering Project (2026–27 ODD) · TIET Patiala

A web application that load-tests HTTP targets: analyze a URL, classify it as
an API or a website, generate edge-case payloads or crawl sitemap paths, run
an asynchronous Locust-based load test, and compare past runs.

**Team Elevate:** Yash Bharadwaj · Nikhil Khosla · Krish Agrawal

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
