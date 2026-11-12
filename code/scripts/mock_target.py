"""
A small, controlled login API to load-test against instead of a public site.

Behaviour (all deliberate, so results are predictable):
  * Valid credentials are username "demo" / password "demo123".
  * 400 for a missing, null, empty or wrong-type username or password, or
    for wrong credentials.
  * expiresInMins is optional: missing, null or 0 -> accepted with a default;
    negative -> 400; a non-integer or a value above 1_000_000 -> an unhandled
    exception (500), modelling a server that never validated this field.
  * A global rate limiter: once more than MOCK_RATE_LIMIT requests arrive in
    the same second (default 40), every further request that second gets 429.
  * Every request takes 50-150 ms of "work" on one of MOCK_WORKERS workers
    (default 8). When more requests arrive than the workers can handle
    (about 80 per second), the extra ones wait in line, so response times
    climb with load the way a real server's do. That is what gives a
    capacity run ("Find capacity") a visible breaking point.
  * Deliberate validation bug: a username longer than 256 characters is
    never length-checked and skips the credential check, so the request is
    accepted with 200. The edge case "very_long_string_username" expects a
    4xx rejection, so the load tester reports it as "accepted invalid input".
  * Optional: if MOCK_REQUIRE_TOKEN is set, every request must carry
    "Authorization: Bearer <that token>", otherwise it gets 401.

Run it with:  python scripts/mock_target.py   (listens on http://127.0.0.1:8000)
"""
import logging
import os
import random
import threading
import time

from flask import Flask, jsonify, request

VALID_USERNAME = "demo"
VALID_PASSWORD = "demo123"
DEFAULT_EXPIRES_IN_MINS = 60
# Deliberate bug threshold: longer usernames are (wrongly) accepted.
BUGGY_USERNAME_LENGTH = 256
MAX_EXPIRES_IN_MINS = 1_000_000
RATE_LIMIT_PER_SECOND = int(os.environ.get("MOCK_RATE_LIMIT", "40"))
# Requests processed at the same time; the rest queue for a free worker.
WORKERS = int(os.environ.get("MOCK_WORKERS", "8"))
_workers = threading.BoundedSemaphore(WORKERS)
# Empty = no authentication required (the default).
REQUIRED_TOKEN = os.environ.get("MOCK_REQUIRE_TOKEN", "")

app = Flask(__name__)

# Rate limiter state: the current one-second window and how many requests
# have arrived in it. The lock stops two threads updating it at once.
_rate_lock = threading.Lock()
_window_second = 0
_window_count = 0


def _over_rate_limit():
    global _window_second, _window_count
    now = int(time.time())
    with _rate_lock:
        if now != _window_second:
            _window_second = now
            _window_count = 0
        _window_count += 1
        return _window_count > RATE_LIMIT_PER_SECOND


def _is_non_empty_string(value):
    return isinstance(value, str) and value != ""


def _resolve_expiry(expires):
    """Returns the expiry in minutes, or raises for values the server was
    never written to handle."""
    if expires is None or expires == 0:
        return DEFAULT_EXPIRES_IN_MINS
    # bool is a subclass of int in Python, so exclude it explicitly.
    if not isinstance(expires, int) or isinstance(expires, bool) or expires > MAX_EXPIRES_IN_MINS:
        # Deliberate bug: no validation, so this escapes as a 500.
        raise ValueError(f"cannot compute token expiry from {expires!r}")
    return expires


@app.route("/api/login", methods=["POST"])
def login():
    # 50-150 ms of work on a free worker; waiting for one is the queueing
    # delay that grows when the server is overloaded.
    with _workers:
        time.sleep(random.uniform(0.05, 0.15))

    if REQUIRED_TOKEN and request.headers.get("Authorization") != f"Bearer {REQUIRED_TOKEN}":
        return jsonify({"message": "Missing or wrong bearer token"}), 401

    if _over_rate_limit():
        return jsonify({"message": "Too many requests"}), 429

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"message": "Request body must be a JSON object"}), 400

    username = body.get("username")
    password = body.get("password")
    # Deliberate validation bug (see the module docstring): the length is
    # never checked, and an over-long username falls through to a success.
    if isinstance(username, str) and len(username) > BUGGY_USERNAME_LENGTH:
        return jsonify({"accessToken": "mock-access-token", "username": username[:20] + "...",
                        "expiresInMins": DEFAULT_EXPIRES_IN_MINS}), 200

    if not _is_non_empty_string(username) or not _is_non_empty_string(password):
        return jsonify({"message": "Username and password are required strings"}), 400
    if username != VALID_USERNAME or password != VALID_PASSWORD:
        return jsonify({"message": "Invalid credentials"}), 400

    expires = body.get("expiresInMins")
    if isinstance(expires, int) and not isinstance(expires, bool) and expires < 0:
        return jsonify({"message": "expiresInMins must not be negative"}), 400

    return jsonify({
        "accessToken": "mock-access-token",
        "username": username,
        "expiresInMins": _resolve_expiry(expires),
    }), 200


if __name__ == "__main__":
    # Per-request access logs would flood the console under load.
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    host, port = os.environ.get("MOCK_HOST", "127.0.0.1"), os.environ.get("MOCK_PORT", "8000")
    print(f"Mock target on http://{host}:{port}/api/login (rate limit {RATE_LIMIT_PER_SECOND} req/s, "
          f"{WORKERS} workers{', bearer token required' if REQUIRED_TOKEN else ''})")
    # MOCK_HOST=0.0.0.0 lets other containers reach it (docker compose).
    app.run(host=os.environ.get("MOCK_HOST", "127.0.0.1"), port=int(os.environ.get("MOCK_PORT", "8000")),
            threaded=True, debug=False)
