"""
Target safety guardrails: which hosts this server may send requests to.

A load tester that fetches any URL a user types is a server-side request
forgery (SSRF) tool: pointed at 10.0.0.5, localhost or the cloud metadata
address, it would probe the network the backend runs in. Before every probe
and every load test the target's hostname is resolved, and each address it
resolves to is checked:

- private, loopback, link-local, multicast, reserved and unspecified
  addresses are blocked unless ALLOW_PRIVATE_TARGETS=true (the default for
  local development, so the mock target on 127.0.0.1 works; the Kubernetes
  deployment sets it to false);
- cloud metadata endpoints (169.254.169.254 and friends) are blocked
  always: no legitimate load test needs them.

A hostname that does not resolve is let through: there is nothing to
connect to, and the request fails as "unreachable" on its own.
"""
import ipaddress
import os
import socket
from urllib.parse import urlparse

# Cloud instance-metadata and platform endpoints (AWS, ECS, GCP, Azure,
# Alibaba). Blocked even when private targets are allowed.
METADATA_ADDRESSES = {
    ipaddress.ip_address(a) for a in (
        "169.254.169.254", "169.254.170.2", "169.254.170.23",
        "100.100.100.200", "168.63.129.16",
        "fd00:ec2::254", "fd00:ec2::23",
    )
}
METADATA_HOSTNAMES = {"metadata.google.internal", "metadata", "instance-data"}

# "Shared address space" (carrier-grade NAT); not flagged by every Python
# version's is_private, but never a public target.
_SHARED = ipaddress.ip_network("100.64.0.0/10")


def private_targets_allowed():
    """ALLOW_PRIVATE_TARGETS, read at call time (default: true)."""
    return os.environ.get("ALLOW_PRIVATE_TARGETS", "true").strip().lower() in ("1", "true", "yes", "on")


def _address_problem(ip, allow_private):
    """Why this address is blocked, or None."""
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    if ip in METADATA_ADDRESSES:
        return "a cloud metadata address"
    if allow_private:
        return None
    if ip.is_loopback:
        return "a loopback address"
    if ip.is_link_local:
        return "a link-local address"
    if ip.is_multicast:
        return "a multicast address"
    if ip.is_unspecified:
        return "an unspecified address"
    if ip.is_private or (ip.version == 4 and ip in _SHARED):
        return "a private address"
    if ip.is_reserved:
        return "a reserved address"
    return None


def check_target(url, allow_private=None, resolver=socket.getaddrinfo):
    """
    Returns None when url may be requested, otherwise a plain-English reason.
    allow_private defaults to the ALLOW_PRIVATE_TARGETS setting; resolver is
    injectable so tests need no DNS.
    """
    if allow_private is None:
        allow_private = private_targets_allowed()
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if not host:
        return "the URL has no host name"
    if host.rstrip(".") in METADATA_HOSTNAMES:
        return f"'{host}' is a cloud metadata host name, which is always blocked"

    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError:
        return "the URL has an invalid port"
    try:
        infos = resolver(host, port, proto=socket.IPPROTO_TCP)
    except (socket.gaierror, UnicodeError, OSError):
        return None  # does not resolve: nothing to connect to

    for info in infos:
        address = info[4][0].split("%")[0]  # strip an IPv6 zone id
        try:
            ip = ipaddress.ip_address(address)
        except ValueError:
            continue
        problem = _address_problem(ip, allow_private)
        if problem:
            hint = "" if problem == "a cloud metadata address" else (
                " Private, loopback, link-local and multicast targets are blocked on this "
                "server (set ALLOW_PRIVATE_TARGETS=true to allow them)."
            )
            return f"'{host}' resolves to {ip}, {problem}.{hint}"
    return None
