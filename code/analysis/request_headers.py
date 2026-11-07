"""
Optional request headers (for example "Authorization: Bearer <token>") that
are sent with the analyze probe and with every request Locust makes.

Header *values* are secrets. They are only ever held in memory and handed to
the Locust process through an environment variable. They are never written to
the database, a file or a log, and never sent back by the API. Only the
header *names* are stored with a run.
"""
import re

MAX_HEADERS = 20
MAX_VALUE_LENGTH = 4096
# RFC 7230 "token" characters.
_NAME_PATTERN = re.compile(r"^[A-Za-z0-9!#$%&'*+.^_`|~-]+$")


def clean_headers(raw):
    """
    Validates headers sent by the browser as {"Name": "value", ...}.

    Returns (headers, error): headers is a dict (empty when none were sent),
    error is None or a message. Messages name the header, never its value.
    """
    if raw is None:
        return {}, None
    if not isinstance(raw, dict):
        return None, "headers must be an object of name: value pairs"
    if len(raw) > MAX_HEADERS:
        return None, f"at most {MAX_HEADERS} headers are allowed"

    headers = {}
    for name, value in raw.items():
        if not isinstance(name, str) or not _NAME_PATTERN.match(name):
            return None, "a header name may only contain letters, digits and - _ . (no spaces)"
        if not isinstance(value, str):
            return None, f"the value of header '{name}' must be text"
        value = value.strip()
        if "\r" in value or "\n" in value:
            return None, f"the value of header '{name}' must be a single line"
        if len(value) > MAX_VALUE_LENGTH:
            return None, f"the value of header '{name}' is too long"
        headers[name] = value
    return headers, None


def header_names(headers):
    """The names only, sorted — the part that is safe to store."""
    return sorted(headers or {})


def redact(text, headers):
    """Replaces every non-empty header value inside text with ***. Used on
    anything that might echo a value back (error messages, Locust output)."""
    if not text or not headers:
        return text
    for value in headers.values():
        if value:
            text = text.replace(value, "***")
    return text
