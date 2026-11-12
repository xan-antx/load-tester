"""
How the requests of a run ended, measured against what a correct API should
have answered (see locust_tests/expectations.py).

In a run whose cases carry expectations, a request counts as a failure only
when the answer did not match: so "handled correctly" is simply every
request that is not a failure. The rest is split into the categories that
failure_summary.py produces.
"""
from analysis.problem_rate import total_requests

# Answers that contradict the expectation itself (not load or crashes).
UNEXPECTED_KINDS = ("accepted_invalid_input", "rejected_valid_input")
# The server failed to answer properly, whatever was expected.
SERVER_ERROR_KINDS = ("server_error", "connection")


def _pct(part, total):
    return round(part / total * 100, 2) if total else None


def kind_counts(failure_summary):
    counts = {}
    for group in failure_summary or []:
        counts[group.get("kind")] = counts.get(group.get("kind"), 0) + group.get("total", 0)
    return counts


def server_error_rate(failure_summary, stats_csv):
    """(5xx + connection failures) / requests, in percent; None if unknown.
    Works for every run, with or without expectations."""
    counts = kind_counts(failure_summary)
    return _pct(sum(counts.get(k, 0) for k in SERVER_ERROR_KINDS), total_requests(stats_csv))


def outcome_summary(failure_summary, stats_csv, case_expectations):
    """
    None for runs without expectations (older runs, website runs). Otherwise:
        total_requests, handled_correctly, handled_correctly_pct,
        accepted_invalid_input, rejected_valid_input, server_error,
        connection, rate_limited, other,
        unexpected_outcome_count / unexpected_outcome_rate_pct
            (accepted invalid + rejected valid),
        server_error_rate_pct (5xx + connection)
    """
    if not case_expectations:
        return None
    total = total_requests(stats_csv)
    if total is None:
        return None
    counts = kind_counts(failure_summary)
    failed = sum(counts.values())
    unexpected = sum(counts.get(k, 0) for k in UNEXPECTED_KINDS)
    server = sum(counts.get(k, 0) for k in SERVER_ERROR_KINDS)
    handled = max(total - failed, 0)
    return {
        "total_requests": total,
        "handled_correctly": handled,
        "handled_correctly_pct": _pct(handled, total),
        "accepted_invalid_input": counts.get("accepted_invalid_input", 0),
        "rejected_valid_input": counts.get("rejected_valid_input", 0),
        "server_error": counts.get("server_error", 0),
        "connection": counts.get("connection", 0),
        "rate_limited": counts.get("rate_limited", 0),
        "other": counts.get("other", 0) + counts.get("rejected", 0),
        "unexpected_outcome_count": unexpected,
        "unexpected_outcome_rate_pct": _pct(unexpected, total),
        "server_error_rate_pct": _pct(server, total),
    }
