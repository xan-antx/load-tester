import requests
from urllib.parse import urlparse

from analysis.request_headers import redact

def is_valid_url_format(url: str) -> bool:
    try:
        result = urlparse(url)
        return all([result.scheme in ("http", "https"), result.netloc])
    except ValueError:
        return False

def check_reachability(url: str, timeout: float = 5.0, headers: dict = None) -> dict:
    """
    Tries HEAD, then GET, then a bodyless POST as a last resort.
    Many API endpoints (especially POST-only ones like /auth/login)
    return 404/405 to HEAD/GET even though they're genuinely live —
    so we don't treat those as unreachable outright; we note the
    server responded and let the caller decide.
    """
    last_result = None
    for method in ("HEAD", "GET", "POST"):
        try:
            if method == "POST":
                resp = requests.post(url, json={}, headers=headers, timeout=timeout, allow_redirects=True)
            else:
                resp = requests.request(method, url, headers=headers, timeout=timeout, allow_redirects=True)

            last_result = {
                "reachable": resp.status_code < 500,  # server responded at all = reachable
                "status_code": resp.status_code,
                "final_url": resp.url,
                "headers": dict(resp.headers),
                "checked_with_method": method,
            }
            # If any method got a genuine success/client-error (not 404/405), stop early
            if resp.status_code not in (404, 405):
                return last_result
        except requests.exceptions.RequestException as e:
            last_result = {
                "reachable": False,
                "status_code": None,
                "final_url": None,
                # Never echo a header value back, even inside an error.
                "error": redact(str(e), headers),
                "checked_with_method": method,
            }
    return last_result

def sanity_check(url: str, headers: dict = None) -> dict:
    if not is_valid_url_format(url):
        return {"valid_format": False, "reachable": False, "error": "Malformed URL"}

    reach_result = check_reachability(url, headers=headers)
    return {"valid_format": True, **reach_result}