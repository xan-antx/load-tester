"""
Turns Locust's failures CSV into a short list of failure *types*.

Locust puts the case name inside each error string, e.g.
    HTTPError('400 Client Error: BAD REQUEST for url: null_password')
so every case looks like its own "distinct error". Here we pull out the HTTP
status code and group by it instead, which gives a handful of meaningful
groups such as "Rejected — invalid input" or "Rate limited".
"""
import csv
import io
import re

# Matches e.g. "400 Client Error: BAD REQUEST for url" and captures 400 and
# "BAD REQUEST".
_STATUS_PATTERN = re.compile(r"\b([1-5]\d\d) (?:Client|Server) Error: (.*?) for url")


def _meaning(code):
    if code is None:
        return "connection", "Connection failure"
    if code == 429:
        return "rate_limited", "Rate limited — too many requests"
    if 400 <= code < 500:
        return "rejected", "Rejected — invalid input"
    if 500 <= code < 600:
        return "server_error", "Server error — the server failed"
    return "other", "Unexpected HTTP status"


def _parse_error(error_text):
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
        kind         - rejected / rate_limited / server_error / connection / other
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
        code, reason = _parse_error(row.get("Error") or "")

        if code not in groups:
            kind, meaning = _meaning(code)
            groups[code] = {
                "code": code, "reason": reason, "kind": kind, "meaning": meaning,
                "total": 0, "cases": {},
            }
        group = groups[code]
        group["total"] += occurrences
        group["cases"][name] = group["cases"].get(name, 0) + occurrences

    result = []
    for group in groups.values():
        cases = [{"case": name, "occurrences": n} for name, n in group["cases"].items()]
        cases.sort(key=lambda c: (-c["occurrences"], c["case"]))
        result.append({**group, "cases": cases})
    result.sort(key=lambda g: -g["total"])
    return result
