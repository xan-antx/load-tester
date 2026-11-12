"""
SLO (service-level objective) pass/fail verdicts for a run.

A run may carry thresholds such as "p95 under 500 ms" and "server errors
under 1 %". When it completes, each threshold is compared with what was
measured and the run gets one verdict: PASS when every measured threshold
holds, FAIL when any does not.

Thresholds (all optional):
    p95_ms                          p95 response time must be <= this (ms)
    avg_ms                          average response time must be <= this (ms)
    max_server_error_rate_pct       (5xx + connection failures) / requests <= this (%)
    max_unexpected_outcome_rate_pct (accepted invalid + rejected valid) / requests
                                    <= this (%); only measurable when the
                                    run's cases carry expected outcomes
    min_rps                         requests per second must be >= this
"""
import csv
import io

from analysis.outcome_summary import server_error_rate

# key -> (label, unit, direction, lowest allowed, highest allowed)
THRESHOLDS = {
    "p95_ms": ("p95 response time", "ms", "max", 1, 600_000),
    "avg_ms": ("Average response time", "ms", "max", 1, 600_000),
    "max_server_error_rate_pct": ("Server errors (5xx + connection)", "%", "max", 0, 100),
    "max_unexpected_outcome_rate_pct": ("Unexpected answers", "%", "max", 0, 100),
    "min_rps": ("Throughput", "req/s", "min", 0, 100_000),
}

# Which measured metric each threshold is compared with.
METRIC_OF = {
    "p95_ms": "p95_ms",
    "avg_ms": "avg_ms",
    "max_server_error_rate_pct": "server_error_rate_pct",
    "max_unexpected_outcome_rate_pct": "unexpected_outcome_rate_pct",
    "min_rps": "rps",
}


def clean_slo(raw):
    """
    Validates SLO thresholds from a request. Returns (slo, error): slo is a
    dict of the given thresholds (None when none were given), error a
    message naming the bad field.
    """
    if raw is None or raw == {}:
        return None, None
    if not isinstance(raw, dict):
        return None, "slo must be an object of thresholds"
    unknown = sorted(set(raw) - set(THRESHOLDS))
    if unknown:
        return None, f"unknown SLO threshold(s): {', '.join(unknown)}"
    slo = {}
    for key, value in raw.items():
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None, f"slo.{key} must be a number"
        _, unit, _, low, high = THRESHOLDS[key]
        if not low <= value <= high:
            return None, f"slo.{key} must be between {low} and {high} {unit}"
        slo[key] = value
    return (slo or None), None


def _aggregated_row(stats_csv):
    if not stats_csv:
        return None
    for row in csv.DictReader(io.StringIO(stats_csv.strip())):
        if row.get("Name") == "Aggregated":
            return row
    return None


def _number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None  # Locust writes "N/A" when there is no data


def run_metrics(stats_csv, failure_summary, outcome_summary=None):
    """The measured values the thresholds are compared with (None = unknown)."""
    total = _aggregated_row(stats_csv) or {}
    return {
        "p95_ms": _number(total.get("95%")),
        "avg_ms": _number(total.get("Average Response Time")),
        "rps": _number(total.get("Requests/s")),
        "server_error_rate_pct": server_error_rate(failure_summary, stats_csv),
        "unexpected_outcome_rate_pct": (outcome_summary or {}).get("unexpected_outcome_rate_pct"),
    }


def evaluate_slo(slo, metrics):
    """
    Returns None when no SLO is set, otherwise:
        verdict       - "PASS", "FAIL", or None if nothing could be measured
        checks        - one per threshold: key, label, unit, comparison
                        ("<=" or ">="), target, actual, passed (None when the
                        metric is not available for this run)
        passed / failed / not_measured - counts
    """
    if not slo:
        return None
    checks = []
    for key in THRESHOLDS:
        if key not in slo:
            continue
        label, unit, direction, _, _ = THRESHOLDS[key]
        target = slo[key]
        actual = metrics.get(METRIC_OF[key])
        if actual is None:
            passed = None
        elif direction == "max":
            passed = actual <= target
        else:
            passed = actual >= target
        checks.append({
            "key": key, "label": label, "unit": unit,
            "comparison": "<=" if direction == "max" else ">=",
            "target": target,
            "actual": None if actual is None else round(actual, 2),
            "passed": passed,
        })
    failed = sum(c["passed"] is False for c in checks)
    passed = sum(c["passed"] is True for c in checks)
    verdict = "FAIL" if failed else ("PASS" if passed else None)
    return {
        "verdict": verdict,
        "checks": checks,
        "passed": passed,
        "failed": failed,
        "not_measured": len(checks) - passed - failed,
    }
