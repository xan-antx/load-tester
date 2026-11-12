"""Target safety guardrails: address checks, endpoints, redirects, CORS."""
import socket

import pytest

import job_store
import load_test_runner
from analysis import sanity_check as sanity_module
from analysis.target_guard import check_target
from app import app


def fake_resolver(address):
    def resolve(host, port, proto=None):
        return [(socket.AF_INET6 if ":" in address else socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, port))]
    return resolve


@pytest.mark.parametrize("address", ["10.0.0.5", "172.16.3.4", "192.168.1.10", "127.0.0.1", "::1",
                                     "169.254.10.10", "224.0.0.1", "0.0.0.0", "100.64.1.1",
                                     "fd12:3456::1", "::ffff:10.0.0.5"])
def test_private_style_addresses_blocked_when_not_allowed(address):
    reason = check_target("http://target.example/api", allow_private=False, resolver=fake_resolver(address))
    assert reason and "target.example" in reason and "ALLOW_PRIVATE_TARGETS" in reason


@pytest.mark.parametrize("address", ["10.0.0.5", "127.0.0.1", "::1"])
def test_private_addresses_allowed_when_configured(address):
    assert check_target("http://t.example/", allow_private=True, resolver=fake_resolver(address)) is None


def test_public_address_allowed():
    assert check_target("https://api.example.com/x", allow_private=False,
                        resolver=fake_resolver("93.184.216.34")) is None


@pytest.mark.parametrize("address", ["169.254.169.254", "fd00:ec2::254", "100.100.100.200", "::ffff:169.254.169.254"])
@pytest.mark.parametrize("allow", [True, False])
def test_metadata_addresses_always_blocked(address, allow):
    reason = check_target("http://innocent.example/", allow_private=allow, resolver=fake_resolver(address))
    assert reason and "metadata" in reason


def test_metadata_host_names_always_blocked():
    assert "metadata" in check_target("http://metadata.google.internal/computeMetadata/v1/", allow_private=True)


def test_unresolvable_host_is_let_through():
    def fail(*args, **kwargs):
        raise socket.gaierror("no such host")
    assert check_target("http://nope.invalid/", allow_private=False, resolver=fail) is None


def test_setting_is_read_from_the_environment(monkeypatch):
    monkeypatch.setenv("ALLOW_PRIVATE_TARGETS", "false")
    assert check_target("http://x/", resolver=fake_resolver("10.1.1.1"))
    monkeypatch.setenv("ALLOW_PRIVATE_TARGETS", "true")
    assert check_target("http://x/", resolver=fake_resolver("10.1.1.1")) is None
    monkeypatch.delenv("ALLOW_PRIVATE_TARGETS")
    assert check_target("http://x/", resolver=fake_resolver("10.1.1.1")) is None  # default: allowed


# ---- endpoints ------------------------------------------------------------------

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(job_store, "DB_PATH", str(tmp_path / "test.db"))
    job_store.init_db()
    started = []
    monkeypatch.setattr(load_test_runner, "_dispatch_single", lambda *a, **k: started.append(a))
    c = app.test_client()
    c.started = started
    return c


CASES = [{"label": "a", "payload": {"x": 1}, "expect": "reject"}]


@pytest.mark.parametrize("path, body", [
    ("/api/analyze", {"url": "http://10.0.0.5/api"}),
    ("/api/sanity-check", {"url": "http://10.0.0.5/api"}),
    ("/api/start-load-test", {"url": "http://10.0.0.5/api", "confirmed_cases": CASES, "i_own_target": True}),
    ("/api/start-website-load-test", {"url": "http://10.0.0.5/", "i_own_target": True}),
])
def test_endpoints_refuse_private_targets_when_not_allowed(client, monkeypatch, path, body):
    monkeypatch.setenv("ALLOW_PRIVATE_TARGETS", "false")
    resp = client.post(path, json=body)
    assert resp.status_code == 400
    assert resp.get_json()["blocked_target"] is True
    assert "10.0.0.5" in resp.get_json()["error"]
    assert client.started == []


def test_metadata_target_refused_even_in_local_mode(client):
    resp = client.post("/api/start-load-test", json={
        "url": "http://169.254.169.254/latest/meta-data", "confirmed_cases": CASES, "i_own_target": True,
    })
    assert resp.status_code == 400 and resp.get_json()["blocked_target"] is True


def test_loopback_allowed_by_default_for_local_development(client):
    resp = client.post("/api/start-load-test", json={
        "url": "http://127.0.0.1:8000/api/login", "confirmed_cases": CASES, "i_own_target": True,
    })
    assert resp.status_code == 202


@pytest.mark.parametrize("path", ["/api/start-load-test", "/api/start-website-load-test"])
@pytest.mark.parametrize("confirmation", [None, False, "yes", 1])
def test_start_requires_explicit_ownership_confirmation(client, path, confirmation):
    body = {"url": "http://127.0.0.1:8000/api/login", "confirmed_cases": CASES}
    if confirmation is not None:
        body["i_own_target"] = confirmation
    resp = client.post(path, json=body)
    assert resp.status_code == 400
    assert resp.get_json()["missing_confirmation"] == "i_own_target"
    assert "permission" in resp.get_json()["error"]
    assert client.started == []


# ---- redirects are re-checked before they are followed ----------------------------

class Resp:
    def __init__(self, status, url, location=None):
        self.status_code, self.url = status, url
        self.headers = {"Location": location} if location else {"Content-Type": "application/json"}


def test_redirect_to_blocked_address_is_not_followed(monkeypatch):
    requested = []

    def fake_request(method, url, **kwargs):
        requested.append(url)
        assert kwargs["allow_redirects"] is False
        return Resp(302, url, location="http://169.254.169.254/latest/meta-data")

    monkeypatch.setattr(sanity_module.requests, "request", fake_request)
    result = sanity_module.check_reachability("http://public.example/start")
    assert result["blocked"] is True and result["reachable"] is False
    assert "metadata" in result["error"]
    assert requested == ["http://public.example/start"]  # the metadata URL was never requested


def test_allowed_redirects_are_followed_hop_by_hop(monkeypatch):
    hops = {"http://a.example/": Resp(301, "http://a.example/", location="/next"),
            "http://a.example/next": Resp(200, "http://a.example/next")}
    seen = []

    def fake_request(method, url, **kwargs):
        seen.append(url)
        return hops[url]

    monkeypatch.setattr(sanity_module.requests, "request", fake_request)
    result = sanity_module.check_reachability("http://a.example/", guard=lambda url: None)
    assert result["status_code"] == 200 and result["final_url"] == "http://a.example/next"
    assert seen == ["http://a.example/", "http://a.example/next"]


def test_analyze_reports_a_blocked_redirect(client, monkeypatch):
    monkeypatch.setattr(sanity_module.requests, "request",
                        lambda method, url, **kw: Resp(302, url, location="http://169.254.169.254/"))
    resp = client.post("/api/analyze", json={"url": "http://127.0.0.1:9/start"})
    body = resp.get_json()
    assert resp.status_code == 400 and body["blocked_target"] is True
    assert body["sanity"]["blocked"] is True


# ---- CORS -------------------------------------------------------------------------

def test_cors_allows_the_dev_frontend_only():
    c = app.test_client()
    allowed = c.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert allowed.headers.get("Access-Control-Allow-Origin") == "http://localhost:5173"
    other = c.get("/api/health", headers={"Origin": "http://evil.example"})
    assert "Access-Control-Allow-Origin" not in other.headers


def test_debug_is_off_by_default():
    assert app.debug is False
