"""
Decides whether one response is what a correct API should have answered.

Imported by dynamic_locustfile.py (inside the Locust process) and by the
unit tests. No Locust imports here, so it stays a pure function.

Categories used in failure messages (failure_summary.py groups by them):
    accepted_invalid_input - 2xx for a case that should be rejected: a validation bug
    rejected_valid_input   - 4xx (not 429) for a case that should be accepted
    server_error           - 5xx, whatever was expected
    rate_limited           - 429, whatever was expected
    connection             - no HTTP response at all
    unexpected_status      - anything else (1xx, an unfollowed 3xx)
"""
ACCEPT = "accept"
REJECT = "reject"


def classify_outcome(status_code, expect):
    """Returns (matches_expectation, category). category is None on a match."""
    if not status_code:
        return False, "connection"
    if status_code == 429:
        return False, "rate_limited"
    if status_code >= 500:
        return False, "server_error"
    is_2xx = 200 <= status_code < 300
    is_4xx = 400 <= status_code < 500
    if expect == ACCEPT:
        if is_2xx:
            return True, None
        if is_4xx:
            return False, "rejected_valid_input"
    elif expect == REJECT:
        if is_4xx:
            return True, None
        if is_2xx:
            return False, "accepted_invalid_input"
    return False, "unexpected_status"


def failure_message(category, status_code, expect, error=None):
    """The text Locust records for a failed request, e.g.
    "accepted_invalid_input (200): expected a 4xx rejection, got 200".
    The category comes first so failure_summary.py can group by it."""
    if category == "connection":
        return f"connection: no response ({error or 'connection failed'})"
    wanted = "a 2xx success" if expect == ACCEPT else "a 4xx rejection"
    return f"{category} ({status_code}): expected {wanted}, got {status_code}"
