"""
Performance regression gate for a CI pipeline.

Starts a load test through the Elevate backend's existing API, waits for it
to finish, compares it with a baseline run and sets the exit code:

    0  no regressions
    1  at least one case got worse than the baseline
    2  error (bad arguments, backend unreachable, run did not complete,
       no baseline to compare with)

Usage (from code/):
    python scripts/regression_gate.py --api http://localhost:5000 \
        --url http://127.0.0.1:8000/api/login --sample scripts/gate_sample.json \
        --users 50 --duration 30 [--baseline-id <id>] [--header "Name: value"]

Only the standard library and requests are used.
"""
import argparse
import json
import math
import sys
import time

import requests

EXIT_OK = 0
EXIT_REGRESSIONS = 1
EXIT_ERROR = 2

TERMINAL_STATUSES = ("completed", "failed", "timeout", "cancelled")


class GateError(Exception):
    """Anything that should end the gate with exit code 2."""


def _int_in_range(low, high):
    def parse(text):
        try:
            value = int(text)
        except ValueError:
            raise argparse.ArgumentTypeError(f"must be a whole number, got {text!r}")
        if not low <= value <= high:
            raise argparse.ArgumentTypeError(f"must be between {low} and {high}")
        return value
    return parse


def parse_header(text):
    """'Name: value' -> (name, value)."""
    name, sep, value = text.partition(":")
    if not sep or not name.strip():
        raise argparse.ArgumentTypeError(f"header must look like 'Name: value', got {text!r}")
    return name.strip(), value.strip()


def parse_args(argv):
    p = argparse.ArgumentParser(description="Fail a CI job when a load test regresses against its baseline.")
    p.add_argument("--api", required=True, help="backend base URL, e.g. http://localhost:5000")
    p.add_argument("--url", required=True, help="target API endpoint to load-test")
    p.add_argument("--sample", required=True, help="path to a JSON file with a sample request body")
    p.add_argument("--users", type=_int_in_range(1, 1000), default=50)
    p.add_argument("--duration", type=_int_in_range(1, 300), default=30, help="seconds")
    p.add_argument("--spawn-rate", type=_int_in_range(1, 20), default=10, help="new users per second")
    p.add_argument("--baseline-id", help="compare with this run instead of the target's stored baseline")
    p.add_argument("--header", type=parse_header, action="append", default=[],
                   help="request header 'Name: value' (repeatable), e.g. 'Authorization: Bearer x'")
    p.add_argument("--poll-interval", type=float, default=2.0, help="seconds between status checks")
    p.add_argument("--timeout", type=int, default=None,
                   help="give up after this many seconds (default: duration + 300)")
    args = p.parse_args(argv)
    args.api = args.api.rstrip("/")
    if args.timeout is None:
        args.timeout = args.duration + 300
    return args


def load_sample(path):
    try:
        with open(path, encoding="utf-8") as f:
            sample = json.load(f)
    except OSError as e:
        raise GateError(f"cannot read sample file: {e}")
    except json.JSONDecodeError as e:
        raise GateError(f"sample file is not valid JSON: {e}")
    if not isinstance(sample, dict):
        raise GateError("sample file must contain a JSON object")
    return sample


def decide(info):
    """
    Turns an /api/regressions response into (exit code, summary lines).
    Pure: no network, no printing.
    """
    if not info.get("baseline"):
        return EXIT_ERROR, [
            "No baseline to compare with. Mark a run of this target as the baseline in the app, "
            "or pass --baseline-id."
        ]

    base = info["baseline"]
    lines = [f"Baseline: run {base.get('id')} ({base.get('users')} users)"]
    change = info.get("p95_change_pct")
    if change is not None:
        lines.append(
            f"p95 response: {info.get('baseline_p95'):.0f} ms -> {info.get('current_p95'):.0f} ms "
            f"({change:+.1f}%)"
        )

    regressions = info.get("regressions") or []
    if not regressions:
        lines.append(
            f"PASS: no case's failure rate rose by {info.get('threshold')} points or more."
        )
        return EXIT_OK, lines

    lines.append(
        f"FAIL: {len(regressions)} case(s) got worse by {info.get('threshold')} points or more:"
    )
    for r in regressions:
        lines.append(f"  {r['case']}: {r['baseline_rate']}% -> {r['current_rate']}% (+{r['increase']} pts)")
    return EXIT_REGRESSIONS, lines


def _call(http, method, url, **kwargs):
    """One HTTP call; any failure becomes a GateError with a readable reason."""
    try:
        resp = http.request(method, url, timeout=30, **kwargs)
    except requests.RequestException as e:
        raise GateError(f"cannot reach the backend ({method} {url}): {e}")
    try:
        data = resp.json()
    except ValueError:
        data = {}
    if resp.status_code >= 400:
        reason = data.get("error") if isinstance(data, dict) else None
        raise GateError(f"{method} {url} returned {resp.status_code}: {reason or 'no details'}")
    return data


def run_gate(args, http=requests, sleep=time.sleep, out=print):
    """Runs the whole gate and returns the exit code. http and sleep are
    injectable so the tests need no network and no waiting."""
    sample = load_sample(args.sample)
    headers = dict(args.header)
    if args.baseline_id:
        # Fail fast (404 -> GateError) instead of after a whole load test.
        _call(http, "GET", f"{args.api}/api/load-test-status/{args.baseline_id}")

    cases = _call(http, "POST", f"{args.api}/api/generate-edge-cases",
                  json={"sample_input": sample})["cases"]
    confirmed = _call(http, "POST", f"{args.api}/api/confirm-selection", json={
        "sample_input": sample, "selected_labels": [c["label"] for c in cases],
    })["confirmed_cases"]

    body = {
        "url": args.url, "confirmed_cases": confirmed, "users": args.users,
        "spawn_rate": args.spawn_rate, "duration_seconds": args.duration,
    }
    if headers:
        body["headers"] = headers
    run_id = _call(http, "POST", f"{args.api}/api/start-load-test", json=body)["job_id"]
    out(f"Started run {run_id}: {args.users} users for {args.duration} s against {args.url}")

    status = None
    for _ in range(max(1, math.ceil(args.timeout / args.poll_interval))):
        status = _call(http, "GET", f"{args.api}/api/load-test-status/{run_id}").get("status")
        if status in TERMINAL_STATUSES:
            break
        sleep(args.poll_interval)
    if status != "completed":
        raise GateError(f"run {run_id} did not complete (status: {status or 'unknown'})")

    params = {"baseline_id": args.baseline_id} if args.baseline_id else None
    info = _call(http, "GET", f"{args.api}/api/regressions/{run_id}", params=params)
    code, lines = decide(info)
    for line in lines:
        out(line)
    return code


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)  # exits with 2 on bad arguments
    try:
        return run_gate(args)
    except GateError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())
