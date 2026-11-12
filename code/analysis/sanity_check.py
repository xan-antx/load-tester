import requests
from urllib.parse import urljoin, urlparse

from analysis.request_headers import redact
from analysis.target_guard import check_target

MAX_REDIRECTS = 5


def is_valid_url_format(url: str) -> bool:
    try:
        result = urlparse(url)
        return all([result.scheme in ("http", "https"), result.netloc])
    except ValueError:
        return False


class BlockedRedirect(Exception):
    """A redirect pointed at an address the target guard blocks."""


# Methods the probe may use, in order. All are read-only by definition: the
# probe must never create, change or delete anything on the user's server
# (an earlier version fell back to POST {}, which a real API may act on).
PROBE_METHODS = ("HEAD", "GET", "OPTIONS")


def _request(method, url, headers, timeout, guard):
    """One request that follows redirects by hand, so every hop is checked
    by the target guard *before* it is requested (requests' own redirect
    handling would already have connected)."""
    for _ in range(MAX_REDIRECTS + 1):
        resp = requests.request(method, url, headers=headers, timeout=timeout, allow_redirects=False)
        location = (resp.headers or {}).get("Location")
        if not (300 <= resp.status_code < 400 and location):
            return resp
        next_url = urljoin(url, location)
        problem = guard(next_url) if guard else None
        if problem:
            raise BlockedRedirect(f"Redirected to a blocked target: {problem}")
        url = next_url
        if resp.status_code == 303:
            method = "GET"
    return resp


def _attempt(method, resp):
    """What type detection needs to know about one probe response."""
    response_headers = resp.headers or {}
    return {
        "method": method,
        "status_code": resp.status_code,
        "content_type": (response_headers.get("Content-Type") or "").lower(),
        # Methods the server says it accepts (Allow on 405 / OPTIONS, or the
        # CORS equivalent).
        "allow": response_headers.get("Allow") or response_headers.get("Access-Control-Allow-Methods") or "",
    }


def _result(method, resp, responses):
    return {
        "reachable": resp.status_code < 500,  # server responded at all = reachable
        "status_code": resp.status_code,
        "final_url": resp.url,
        "headers": dict(resp.headers or {}),
        "checked_with_method": method,
        "attempts": [_attempt(m, r) for m, r in responses],
    }


def check_reachability(url: str, timeout: float = 5.0, headers: dict = None, guard=check_target) -> dict:
    """
    Tries HEAD, then GET, then OPTIONS — read-only methods only, never POST.
    Many API endpoints (especially POST-only ones like /auth/login) answer
    HEAD/GET with 404/405 even though they are genuinely live, so those are
    not treated as unreachable: the result says "reachable, method not
    allowed" (method_not_allowed: true, allowed_methods from the Allow
    header) and keeps the status GET got. Every attempt is listed in
    "attempts" for type detection.
    Redirects are followed by hand and every hop is re-checked by guard.
    """
    responses = []
    error_result = None
    for method in PROBE_METHODS:
        try:
            resp = _request(method, url, headers, timeout, guard)
        except BlockedRedirect as e:
            return {
                "reachable": False,
                "status_code": None,
                "final_url": None,
                "blocked": True,
                "error": str(e),
                "checked_with_method": method,
            }
        except requests.exceptions.RequestException as e:
            error_result = {
                "reachable": False,
                "status_code": None,
                "final_url": None,
                # Never echo a header value back, even inside an error.
                "error": redact(str(e), headers),
                "checked_with_method": method,
            }
            continue
        responses.append((method, resp))
        # A genuine HEAD/GET answer (not 404/405) settles it.
        if method != "OPTIONS" and resp.status_code not in (404, 405):
            return _result(method, resp, responses)

    if not responses:
        return error_result
    # HEAD and GET were refused (404/405) or failed, but the server answered.
    method, resp = responses[-1]
    result = _result(method, resp, responses)
    refused = [(m, r) for m, r in responses if m != "OPTIONS" and r.status_code in (404, 405)]
    if refused:
        result["status_code"] = refused[-1][1].status_code
        result["method_not_allowed"] = True
        result["allowed_methods"] = _attempt(method, resp)["allow"] or None
        result["reachable"] = any(r.status_code < 500 for _, r in responses)
    return result


def sanity_check(url: str, headers: dict = None) -> dict:
    if not is_valid_url_format(url):
        return {"valid_format": False, "reachable": False, "error": "Malformed URL"}

    reach_result = check_reachability(url, headers=headers)
    return {"valid_format": True, **reach_result}
