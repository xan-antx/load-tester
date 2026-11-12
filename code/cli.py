"""
Command-line runner for Elevate Load Tester: one load test from a config file,
with a pass/fail exit code for CI pipelines.

    python cli.py run --config loadtest.yml
    python cli.py run --config loadtest.yml --users 30 --duration 20
    python cli.py run --url http://127.0.0.1:8000/api/login --sample sample.json --i-own-target

It only talks to the backend's HTTP API (base URL from --api, the config,
or ELEVATE_API; default http://localhost:5000):
    analyze -> generate and confirm cases (API targets) -> start -> poll
and then prints a readable summary with the SLO verdict, and writes a
Markdown report, the full JSON result and a short summary.md (for CI job
summaries) into the output directory.

Exit codes:
    0  the SLO passed (or no SLO was set and the run completed);
       capacity mode: the target sustained at least the required users
    1  the SLO failed; capacity mode: it did not
    2  error: bad config, backend unreachable, run did not complete
"""
import argparse
import json
import math
import os
import sys
import time

import requests
import yaml

EXIT_PASS, EXIT_FAIL, EXIT_ERROR = 0, 1, 2
DEFAULT_API = "http://localhost:5000"
TERMINAL = ("completed", "failed", "timeout", "cancelled", "interrupted")
SLO_KEYS = ("p95_ms", "avg_ms", "max_server_error_rate_pct", "max_unexpected_outcome_rate_pct", "min_rps")


class CliError(Exception):
    """Ends the run with exit code 2."""


# ---- configuration ---------------------------------------------------------------

def parse_args(argv):
    p = argparse.ArgumentParser(prog="cli.py", description="Run a load test through the Elevate backend.")
    sub = p.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="run one load test and report the SLO verdict")
    run.add_argument("--config", help="YAML config file (see loadtest.example.yml)")
    run.add_argument("--api", help=f"backend base URL (default: $ELEVATE_API or {DEFAULT_API})")
    run.add_argument("--url", help="target URL")
    run.add_argument("--sample", help="sample JSON body: a file path or inline JSON")
    run.add_argument("--cases", help="comma-separated case labels to send (default: the config, or all)")
    run.add_argument("--mode", choices=("fixed", "capacity"))
    run.add_argument("--users", type=int)
    run.add_argument("--spawn-rate", type=int)
    run.add_argument("--duration", type=int, help="seconds (fixed mode)")
    run.add_argument("--start-users", type=int)
    run.add_argument("--step-users", type=int)
    run.add_argument("--step-duration", type=int, help="seconds per step (capacity mode)")
    run.add_argument("--max-users", type=int)
    run.add_argument("--slo-p95-ms", type=float)
    run.add_argument("--slo-avg-ms", type=float)
    run.add_argument("--slo-server-error-pct", type=float)
    run.add_argument("--slo-unexpected-pct", type=float)
    run.add_argument("--slo-min-rps", type=float)
    run.add_argument("--out-dir", help="where to write the report and JSON (default: loadtest-results)")
    run.add_argument("--i-own-target", action="store_true", default=None,
                     help="confirm you own the target or may load-test it (or i_own_target: true in the config)")
    run.add_argument("--header", action="append", default=[], help="request header 'Name: value' (repeatable)")
    run.add_argument("--timeout", type=int, help="give up after this many seconds (default: run length + 300)")
    return p.parse_args(argv)


def load_config(args, environ=os.environ):
    """The config file (if any) with command-line flags layered on top."""
    config = {}
    if args.config:
        try:
            with open(args.config, encoding="utf-8") as f:
                config = yaml.safe_load(f) or {}
        except OSError as e:
            raise CliError(f"cannot read config: {e}")
        except yaml.YAMLError as e:
            raise CliError(f"config is not valid YAML: {e}")
        if not isinstance(config, dict):
            raise CliError("config must be a mapping")
    target = dict(config.get("target") or {})
    load = dict(config.get("load") or {})
    capacity = dict(config.get("capacity") or {})
    slo = dict(config.get("slo") or {})
    cases = dict(config.get("cases") or {})
    output = dict(config.get("output") or {})

    # (section, key, flag value): a flag that was given replaces the config value.
    overrides = [
        (target, "url", args.url), (load, "mode", args.mode), (load, "users", args.users),
        (load, "spawn_rate", args.spawn_rate), (load, "duration_seconds", args.duration),
        (capacity, "start_users", args.start_users), (capacity, "step_users", args.step_users),
        (capacity, "step_duration_seconds", args.step_duration), (capacity, "max_users", args.max_users),
        (slo, "p95_ms", args.slo_p95_ms), (slo, "avg_ms", args.slo_avg_ms),
        (slo, "max_server_error_rate_pct", args.slo_server_error_pct),
        (slo, "max_unexpected_outcome_rate_pct", args.slo_unexpected_pct), (slo, "min_rps", args.slo_min_rps),
        (output, "dir", args.out_dir), (target, "i_own_target", args.i_own_target),
    ]
    for section, key, value in overrides:
        if value is not None:
            section[key] = value
    headers = dict(target.get("headers") or {})
    for text in args.header:
        name, sep, value = text.partition(":")
        if not sep or not name.strip():
            raise CliError(f"header must look like 'Name: value', got {text!r}")
        headers[name.strip()] = value.strip()
    target["headers"] = headers

    if args.cases:
        cases["include"] = [c.strip() for c in args.cases.split(",") if c.strip()]
    sample = config.get("sample")
    if args.sample:
        sample = _read_sample(args.sample)
    unknown = sorted(set(slo) - set(SLO_KEYS))
    if unknown:
        raise CliError(f"unknown SLO threshold(s): {', '.join(unknown)}")
    if not target.get("url"):
        raise CliError("no target URL: set target.url in the config or pass --url")
    if target.get("i_own_target") is not True:
        raise CliError("confirm you own the target or may load-test it: i_own_target: true or --i-own-target")
    mode = load.get("mode", "fixed")
    if mode not in ("fixed", "capacity"):
        raise CliError('load.mode must be "fixed" or "capacity"')

    return {
        "api": (args.api or config.get("api") or environ.get("ELEVATE_API") or DEFAULT_API).rstrip("/"),
        "target": target,
        "sample": sample,
        "cases": cases,
        "mode": mode,
        "load": load,
        "capacity": capacity,
        "slo": {k: v for k, v in slo.items() if v is not None},
        "out_dir": output.get("dir", "loadtest-results"),
        "timeout": args.timeout,
    }


def _read_sample(text):
    if os.path.exists(text):
        with open(text, encoding="utf-8") as f:
            text = f.read()
    try:
        return json.loads(text)
    except ValueError as e:
        raise CliError(f"sample is not valid JSON: {e}")


def select_cases(generated, case_config):
    """Labels to send and expectation overrides from the config's cases
    section: include ("all" or a list), exclude (a list), expect
    ({label: accept|reject})."""
    labels = [c["label"] for c in generated]
    include = case_config.get("include", "all")
    chosen = labels if include in (None, "all") else list(include)
    unknown = sorted(set(chosen) - set(labels))
    if unknown:
        raise CliError(f"unknown case label(s) in cases.include: {', '.join(unknown)}")
    exclude = set(case_config.get("exclude") or [])
    chosen = [label for label in chosen if label not in exclude]
    if not chosen:
        raise CliError("no cases left to send after include/exclude")
    expect = dict(case_config.get("expect") or {})
    bad = {k: v for k, v in expect.items() if v not in ("accept", "reject")}
    if bad:
        raise CliError(f"cases.expect values must be accept or reject: {bad}")
    return chosen, expect


# ---- talking to the backend --------------------------------------------------------------

def _call(http, method, url, **kwargs):
    try:
        resp = http.request(method, url, timeout=60, **kwargs)
    except requests.RequestException as e:
        raise CliError(f"cannot reach the backend ({method} {url}): {e}")
    try:
        data = resp.json()
    except ValueError:
        data = {}
    if resp.status_code >= 400:
        reason = data.get("error") if isinstance(data, dict) else None
        raise CliError(f"{method} {url} returned {resp.status_code}: {reason or 'no details'}")
    return data


def start_body(cfg):
    load, target = cfg["load"], cfg["target"]
    body = {
        "url": target["url"],
        "i_own_target": True,
        "users": load.get("users", 10),
        "spawn_rate": load.get("spawn_rate", 10),
        "duration_seconds": load.get("duration_seconds", 30),
    }
    if target.get("headers"):
        body["headers"] = target["headers"]
    if cfg["slo"]:
        body["slo"] = cfg["slo"]
    if cfg["mode"] == "capacity":
        body["mode"] = "capacity"
        body["capacity"] = {k: v for k, v in cfg["capacity"].items()
                            if k in ("start_users", "step_users", "step_duration_seconds", "max_users", "early_stop")}
    return body


def expected_seconds(cfg):
    if cfg["mode"] == "capacity":
        c = cfg["capacity"]
        steps = math.floor((c.get("max_users", 0) - c.get("start_users", 0)) / max(c.get("step_users", 1), 1)) + 1
        return max(steps, 1) * c.get("step_duration_seconds", 10)
    return cfg["load"].get("duration_seconds", 30)


def run(cfg, http=requests, sleep=time.sleep, out=print):
    """Runs the test; returns (exit code, final status)."""
    api = cfg["api"]
    _call(http, "GET", f"{api}/api/health")
    analysis = _call(http, "POST", f"{api}/api/analyze",
                     json={"url": cfg["target"]["url"], "headers": cfg["target"].get("headers") or {}})
    kind = (analysis.get("type_detection") or {}).get("classification")
    out(f"Target {cfg['target']['url']} looks like: {kind or 'unknown'}")

    body = start_body(cfg)
    if kind == "website":
        if analysis.get("sitemap", {}).get("raw"):
            body["sitemap_raw"] = analysis["sitemap"]["raw"]
        started = _call(http, "POST", f"{api}/api/start-website-load-test", json=body)
    else:
        if not isinstance(cfg["sample"], dict):
            raise CliError("an API target needs a sample JSON object (sample: in the config or --sample)")
        generated = _call(http, "POST", f"{api}/api/generate-edge-cases",
                          json={"sample_input": cfg["sample"]})["cases"]
        labels, expect = select_cases(generated, cfg["cases"])
        confirmed = _call(http, "POST", f"{api}/api/confirm-selection", json={
            "sample_input": cfg["sample"], "selected_labels": labels, "expectations": expect,
        })["confirmed_cases"]
        body["confirmed_cases"] = confirmed
        started = _call(http, "POST", f"{api}/api/start-load-test", json=body)
    run_id = started["job_id"]
    out(f"Started run {run_id} ({cfg['mode']} mode, {len(body.get('confirmed_cases') or [])} cases)")

    limit = cfg["timeout"] or expected_seconds(cfg) + 300
    status = None
    for _ in range(max(1, math.ceil(limit / 2))):
        status = _call(http, "GET", f"{api}/api/load-test-status/{run_id}")
        if status.get("status") in TERMINAL:
            break
        sleep(2)
    if not status or status.get("status") not in TERMINAL:
        raise CliError(f"run {run_id} did not finish within {limit} s")
    return decide(cfg, status), status


# ---- verdict, summary and report ----------------------------------------------------------------

def decide(cfg, status):
    """The exit code for a finished run."""
    if status.get("status") != "completed":
        return EXIT_ERROR
    if cfg["mode"] == "capacity":
        capacity = status.get("capacity") or {}
        need = cfg["capacity"].get("min_users", cfg["capacity"].get("start_users", 1))
        held = capacity.get("max_sustainable_users")
        return EXIT_PASS if held is not None and held >= need else EXIT_FAIL
    verdict = (status.get("slo_verdict") or {}).get("verdict")
    if verdict == "FAIL":
        return EXIT_FAIL
    if cfg["slo"] and verdict is None:
        return EXIT_FAIL  # an SLO was set but nothing in it could be measured
    return EXIT_PASS


def _aggregated(status):
    import csv
    import io
    text = status.get("aggregated_stats_csv") or status.get("stats_csv") or ""
    for row in csv.DictReader(io.StringIO(text.strip())):
        if row.get("Name") == "Aggregated":
            return row
    return {}


def _num(value, digits=0):
    try:
        return f"{float(value):.{digits}f}"
    except (TypeError, ValueError):
        return "-"


def verdict_table(cfg, status, code, plain=False):
    """Markdown: the verdict line and a table of thresholds (or steps).
    plain=True uses ASCII only, for consoles that cannot print ≤ or emoji."""
    lines = []
    word = {EXIT_PASS: "PASS", EXIT_FAIL: "FAIL", EXIT_ERROR: "ERROR"}[code]
    if cfg["mode"] == "capacity":
        capacity = status.get("capacity") or {}
        lines += [f"### Capacity: {word}", "", f"**{capacity.get('headline', 'no result')}**", ""]
        if capacity.get("breaking_point_users") is not None:
            lines += [f"Breaking point: {capacity['breaking_point_users']} users ({capacity['breaking_reason']}).", ""]
        lines += ["| Users | Req/s | p95 ms | Server errors % | Verdict |", "|---|---|---|---|---|"]
        for s in capacity.get("steps", []):
            lines.append(f"| {s['planned_users']} | {_num(s['rps'], 1)} | {_num(s['p95_ms'])} | "
                         f"{_num(s['server_error_rate_pct'], 1)} | {s['verdict'] if s['complete'] else 'partial'} |")
        return "\n".join(lines) + "\n"
    verdict = status.get("slo_verdict")
    lines += [f"### SLO verdict: {word}", ""]
    if not verdict:
        lines.append("No SLO was set." if not cfg["slo"] else "The run did not complete, so no verdict.")
        return "\n".join(lines) + "\n"
    lines += ["| Threshold | Target | Actual | Result |", "|---|---|---|---|"]
    for c in verdict["checks"]:
        if plain:
            sign = c["comparison"]
            result = {True: "met", False: "MISSED", None: "not measured"}[c["passed"]]
        else:
            sign = "≤" if c["comparison"] == "<=" else "≥"
            result = {True: "✅ met", False: "❌ missed", None: "not measured"}[c["passed"]]
        # A split run's p95 is merged from parallel Locust processes: approximate.
        approx = ("~" if plain else "≈") if status.get("child_jobs") and c["key"] == "p95_ms" else ""
        actual = "-" if c["actual"] is None else f"{approx}{c['actual']} {c['unit']}"
        lines.append(f"| {c['label']} | {sign} {c['target']} {c['unit']} | {actual} | {result} |")
    return "\n".join(lines) + "\n"


def summary_text(cfg, status, code):
    """The readable console summary."""
    agg = _aggregated(status)
    outcomes = status.get("outcome_summary") or {}
    lines = [
        "",
        f"Run {status.get('job_id') or status.get('group_id')}: {status.get('status')}"
        f"{' (split into %d parallel Locust processes; p95 approximate)' % len(status['child_jobs']) if status.get('child_jobs') else ''}",
        f"  requests {agg.get('Request Count', '-')}, {_num(agg.get('Requests/s'), 2)} req/s, "
        f"avg {_num(agg.get('Average Response Time'))} ms, p95 {_num(agg.get('95%'))} ms",
    ]
    if outcomes:
        lines.append(f"  handled correctly {outcomes['handled_correctly_pct']}%, "
                     f"accepted invalid input {outcomes['accepted_invalid_input']}, "
                     f"rejected valid input {outcomes['rejected_valid_input']}, "
                     f"server errors {outcomes['server_error'] + outcomes['connection']}, "
                     f"rate limited {outcomes['rate_limited']}")
    lines += ["", verdict_table(cfg, status, code, plain=True)]
    return "\n".join(lines)


def report_markdown(cfg, status, code):
    """The Markdown report written next to the JSON result."""
    agg = _aggregated(status)
    split = bool(status.get("child_jobs"))
    lines = [
        "# Load test report — Elevate Load Tester (CLI)",
        "",
        f"- Target: {cfg['target']['url']}",
        f"- Run id: {status.get('job_id') or status.get('group_id')}",
        f"- Mode: {cfg['mode']}",
        f"- Status: {status.get('status')}",
        f"- Started: {status.get('created_at')}",
        f"- Locust processes: {len(status['child_jobs'])}, in parallel on the same host (split run; "
        f"merged p95 is an approximation)" if split else "- Locust processes: 1",
        "",
        "## Summary",
        "",
        "| Metric | Value |",
        "|---|---|",
        f"| Requests | {agg.get('Request Count', '—')} |",
        f"| Requests per second | {_num(agg.get('Requests/s'), 2)} |",
        f"| Average response | {_num(agg.get('Average Response Time'))} ms |",
        f"| p95 response | {'≈' if split else ''}{_num(agg.get('95%'))} ms"
        f"{' (approximate, split run)' if split else ''} |",
        f"| Problem rate (5xx, 429, connection) | {status.get('problem_rate', '—')}% |",
    ]
    outcomes = status.get("outcome_summary")
    if outcomes:
        lines += [f"| Handled correctly | {outcomes['handled_correctly_pct']}% |",
                  f"| Unexpected answers | {outcomes['unexpected_outcome_rate_pct']}% |"]
    lines += ["", verdict_table(cfg, status, code)]
    failures = status.get("failure_summary") or []
    if failures:
        lines += ["## Failure types", "", "| Kind | Status | Total | Cases |", "|---|---|---|---|"]
        for g in failures:
            cases = ", ".join(f"{c['case']} ×{c['occurrences']}" for c in g["cases"][:8])
            lines.append(f"| {g['meaning']} | {g['code'] if g['code'] is not None else '—'} | {g['total']} | {cases} |")
    if status.get("header_names"):
        lines += ["", f"Request headers sent: {', '.join(status['header_names'])} (values not included)."]
    return "\n".join(lines) + "\n"


def write_outputs(cfg, status, code):
    os.makedirs(cfg["out_dir"], exist_ok=True)
    short = str(status.get("job_id") or status.get("group_id") or "run")[:8]
    paths = {
        "report": os.path.join(cfg["out_dir"], f"report-{short}.md"),
        "json": os.path.join(cfg["out_dir"], f"result-{short}.json"),
        "summary": os.path.join(cfg["out_dir"], "summary.md"),
    }
    with open(paths["report"], "w", encoding="utf-8") as f:
        f.write(report_markdown(cfg, status, code))
    with open(paths["json"], "w", encoding="utf-8") as f:
        json.dump({"exit_code": code, "config": {k: v for k, v in cfg.items() if k != "target"},
                   "target_url": cfg["target"]["url"], "status": status}, f, indent=2)
    with open(paths["summary"], "w", encoding="utf-8") as f:
        f.write(verdict_table(cfg, status, code))
    return paths


def main(argv=None, http=requests, sleep=time.sleep, out=print):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        cfg = load_config(args)
        code, status = run(cfg, http=http, sleep=sleep, out=out)
        paths = write_outputs(cfg, status, code)
        out(summary_text(cfg, status, code))
        out(f"Report: {paths['report']}\nJSON:   {paths['json']}")
        return code
    except CliError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return EXIT_ERROR
    except Exception as e:  # never let a crash look like "SLO failed" (exit 1)
        print(f"ERROR: unexpected {type(e).__name__}: {e}", file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())
