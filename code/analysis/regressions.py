"""
Compares a run against a saved "baseline" run of the same target.

This is the core idea of automated regression testing: keep a known-good
result, and on every new run flag anything that got noticeably worse.
"""
import csv
import io

from analysis.case_comparison import CHANGE_THRESHOLD, MIN_REQUESTS, _per_case_counts


def _aggregated_p95(stats_csv):
    """p95 of the first "Aggregated" row, or None. (Older split runs stored
    two Aggregated rows; the first one is the correct total.)"""
    if not stats_csv:
        return None
    for row in csv.DictReader(io.StringIO(stats_csv.strip())):
        if row.get("Name") == "Aggregated":
            try:
                return float(row.get("95%"))
            except (TypeError, ValueError):
                return None
    return None


def detect_regressions(baseline_stats_csv, current_stats_csv,
                       threshold=CHANGE_THRESHOLD, min_requests=MIN_REQUESTS):
    """
    Returns:
        regressions     - cases whose failure rate rose by >= threshold
                          percentage points, where both runs had at least
                          min_requests requests for that case; biggest first.
                          Each: {case, baseline_rate, current_rate, increase,
                          baseline_requests, current_requests}
        baseline_p95, current_p95 - overall p95 in ms (None if unknown)
        p95_change_pct  - percent change of p95 vs the baseline (None if unknown)
        threshold, min_requests - the rules used
    """
    baseline = _per_case_counts(baseline_stats_csv)
    current = _per_case_counts(current_stats_csv)

    regressions = []
    for case in sorted(set(baseline) & set(current)):
        base_req, base_fail = baseline[case]
        cur_req, cur_fail = current[case]
        if base_req < min_requests or cur_req < min_requests:
            continue
        base_rate = base_fail / base_req * 100
        cur_rate = cur_fail / cur_req * 100
        if cur_rate - base_rate >= threshold:
            regressions.append({
                "case": case,
                "baseline_rate": round(base_rate, 1),
                "current_rate": round(cur_rate, 1),
                "increase": round(cur_rate - base_rate, 1),
                "baseline_requests": base_req,
                "current_requests": cur_req,
            })
    regressions.sort(key=lambda r: (-r["increase"], r["case"]))

    base_p95 = _aggregated_p95(baseline_stats_csv)
    cur_p95 = _aggregated_p95(current_stats_csv)
    p95_change = None
    if base_p95 and cur_p95 is not None:
        p95_change = round((cur_p95 - base_p95) / base_p95 * 100, 1)

    return {
        "regressions": regressions,
        "baseline_p95": base_p95,
        "current_p95": cur_p95,
        "p95_change_pct": p95_change,
        "threshold": threshold,
        "min_requests": min_requests,
    }
