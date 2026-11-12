"""
Turns Locust's failures CSV into a short list of failure *types*.

Locust puts the case name inside each error string, e.g.
    HTTPError('400 Client Error: BAD REQUEST for url: null_password')
so every case looks like its own "distinct error". Here we pull out the HTTP
status code and group by it instead, which gives a handful of meaningful
groups such as "Rejected — invalid input" or "Rate limited".

Runs whose cases carry an expectation ("accept" / "reject") record their own
messages instead, e.g.
    CatchResponseError('accepted_invalid_input (200): expected a 4xx rejection, got 200')
Those are grouped by category and status code; a 4xx on a "reject" case is
not a failure at all in such runs.
"""
import csv
import io
import re

# Matches e.g. "400 Client Error: BAD REQUEST for url" and captures 400 and
# "BAD REQUEST".
_STATUS_PATTERN = re.compile(r"\b([1-5]\d\d) (?:Client|Server) Error: (.*?) for url")

# Messages written by locust_tests/expectations.py.
_CATEGORY_PATTERN = re.compile(
    r"\b(accepted_invalid_input|rejected_valid_input|server_error|rate_limited|unexpected_status)"
    r" \((\d{3})\): ([^'\"]*)"
)
_CONNECTION_PATTERN = re.compile(r"\bconnection: (no response[^'\"]*)")

# kind and plain-English meaning for each expectation category.
CATEGORY_MEANINGS = {
    "accepted_invalid_input": (
        "accepted_invalid_input",
        "Accepted invalid input — the API answered 2xx to a request it should have rejected "
        "(a validation bug, or an optional field: set the case to expect 2xx)",
    ),
    "rejected_valid_input": (
        "rejected_valid_input",
        "Rejected valid input — the API answered 4xx to a request that should have succeeded",
    ),
    "server_error": ("server_error", "Server error — the server failed"),
    "rate_limited": ("rate_limited", "Rate limited — too many requests"),
    "unexpected_status": ("other", "Unexpected HTTP status"),
    "connection": ("connection", "Connection failure — no response"),
}


def _meaning(code):
    if code is None:
        return "connection", "Connection failure"
    if code == 429:
        return "rate_limited", "Rate limited — too many requests"
    if code in (401, 403):
        return "rejected", "Rejected — not authorised (check the request headers)"
    if 400 <= code < 500:
        return "rejected", "Rejected — invalid input"
    if 500 <= code < 600:
        return "server_error", "Server error — the server failed"
    return "other", "Unexpected HTTP status"


def _parse_error(error_text):
    """Returns (status code or None, short reason, category or None)."""
    match = _CATEGORY_PATTERN.search(error_text)
    if match:
        return int(match.group(2)), match.group(3).strip(), match.group(1)
    match = _CONNECTION_PATTERN.search(error_text)
    if match:
        return None, match.group(1).strip()[:120], "connection"
    code, reason = _parse_legacy_error(error_text)
    return code, reason, None


def _parse_legacy_error(error_text):
    """Returns (status code or None, short reason)."""
    match = _STATUS_PATTERN.search(error_text)
    if match:
        return int(match.group(1)), match.group(2).strip()
    # No status code: a connection problem or timeout. Keep the start of the
    # raw message as the reason.
    return None, error_text[:120]


def summarize_failures(failures_csv_text):
    """
    Groups a Locust failures CSV by HTTP status code.

    Returns a list (largest group first) of dicts:
        code         - HTTP status code, or None for connection failures
        reason       - the server's reason phrase, e.g. "BAD REQUEST"
        kind         - rejected / rate_limited / server_error / connection / other,
                       or, in runs with expectations, accepted_invalid_input /
                       rejected_valid_input
        meaning      - plain-English explanation of the group
        total        - total occurrences in the group
        cases        - [{"case": name, "occurrences": n}], most first
    Empty or missing input returns [].
    """
    if not failures_csv_text:
        return []

    groups = {}
    reader = csv.DictReader(io.StringIO(failures_csv_text.strip()))
    for row in reader:
        name = row.get("Name")
        if not name:
            continue
        try:
            occurrences = int(float(row.get("Occurrences") or 0))
        except ValueError:
            occurrences = 0
        code, reason, category = _parse_error(row.get("Error") or "")
        kind, meaning = CATEGORY_MEANINGS[category] if category else _meaning(code)

        key = (kind, code)
        if key not in groups:
            groups[key] = {
                "code": code, "reason": reason, "kind": kind, "meaning": meaning,
                "total": 0, "cases": {},
            }
        group = groups[key]
        group["total"] += occurrences
        group["cases"][name] = group["cases"].get(name, 0) + occurrences

    result = []
    for group in groups.values():
        cases = [{"case": name, "occurrences": n} for name, n in group["cases"].items()]
        cases.sort(key=lambda c: (-c["occurrences"], c["case"]))
        result.append({**group, "cases": cases})
    result.sort(key=lambda g: -g["total"])
    return result
