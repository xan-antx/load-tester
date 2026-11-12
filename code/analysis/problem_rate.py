"""
"Problem rate": the share of requests that point at a real problem.

The failure rate counts every non-2xx answer as a failure, including the 400s
a well-behaved API *should* send back for invalid edge cases. That makes a
correct API look alarming. The problem rate counts only the outcomes that
mean something went wrong on the server side or on the way there:

    5xx (server error) + 429 (rate limited) + connection failures
    -------------------------------------------------------------
                         total requests
"""
import csv
import io

PROBLEM_KINDS = ("server_error", "rate_limited", "connection")


def total_requests(stats_csv):
    """Request count of the first "Aggregated" row, or None. (Older split
    runs stored two Aggregated rows; the first is the correct total.)"""
    if not stats_csv:
        return None
    for row in csv.DictReader(io.StringIO(stats_csv.strip())):
        if row.get("Name") == "Aggregated":
            try:
                return int(float(row.get("Request Count") or 0))
            except ValueError:
                return None
    return None


def problem_rate(failure_summary, stats_csv):
    """
    failure_summary - the list from analysis.failure_summary.summarize_failures
    stats_csv       - the run's Locust stats CSV (for the total request count)

    Returns {"problem_count": int, "problem_rate": percent with one decimal,
    or None when the total is unknown or zero}.
    """
    problems = sum(
        group.get("total", 0)
        for group in failure_summary or []
        if group.get("kind") in PROBLEM_KINDS
    )
    total = total_requests(stats_csv)
    rate = round(problems / total * 100, 1) if total else None
    return {"problem_count": problems, "problem_rate": rate}
