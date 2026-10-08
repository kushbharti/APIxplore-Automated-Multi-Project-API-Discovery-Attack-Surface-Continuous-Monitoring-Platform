"""
app/core/ssrf.py
================
SSRF (Server-Side Request Forgery) protection.

CRITICAL: This module must be called before ANY outbound HTTP request is made,
whether for discovery or monitoring.

Protection strategy:
1. Validate URL scheme (only http/https allowed)
2. Resolve hostname to IP address
3. Validate the resolved IP is not in a blocked range
4. Block: loopback, private networks, link-local, cloud metadata endpoints
5. Re-validate after redirects (handled by caller)

Design notes:
- Does NOT rely on string matching alone — always resolves DNS
- Raises SSRFBlockedError (domain exception) for blocked URLs
- Safe to call multiple times (idempotent validation)
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

import structlog

from app.core.exceptions import SSRFBlockedError

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Blocked IP ranges
# ---------------------------------------------------------------------------

_BLOCKED_NETWORKS = [
    # Loopback
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
    # Private networks (RFC 1918)
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    # Link-local
    ipaddress.ip_network("169.254.0.0/16"),  # Also AWS/GCP/Azure metadata
    ipaddress.ip_network("fe80::/10"),
    # Unspecified / any
    ipaddress.ip_network("0.0.0.0/8"),
    # Unique local (IPv6 private)
    ipaddress.ip_network("fc00::/7"),
    # Multicast
    ipaddress.ip_network("224.0.0.0/4"),
    ipaddress.ip_network("ff00::/8"),
    # Documentation ranges
    ipaddress.ip_network("192.0.2.0/24"),
    ipaddress.ip_network("198.51.100.0/24"),
    ipaddress.ip_network("203.0.113.0/24"),
]

# Cloud metadata endpoints — must always be blocked regardless of IP range
_CLOUD_METADATA_HOSTNAMES = {
    "metadata.google.internal",
    "metadata.goog",
    "169.254.169.254",  # AWS/GCP/Azure metadata IP
    "fd00:ec2::254",    # AWS IPv6 metadata
}

# Allowed schemes — only HTTP and HTTPS
_ALLOWED_SCHEMES = {"http", "https"}


def is_ip_blocked(ip_str: str) -> bool:
    """
    Return True if the given IP address string is in a blocked range.

    Args:
        ip_str: IP address as string (IPv4 or IPv6).

    Returns:
        True if the IP is blocked, False if it's safe.
    """
    try:
        addr = ipaddress.ip_address(ip_str)
        return any(addr in network for network in _BLOCKED_NETWORKS)
    except ValueError:
        # Invalid IP format — block it
        return True


def validate_url_for_outbound(url: str, *, context: str = "request") -> str:
    """
    Validate a URL is safe for outbound requests.

    Performs:
    1. URL parsing and scheme validation
    2. Hostname extraction and cloud metadata check
    3. DNS resolution
    4. IP range validation of all resolved addresses

    Args:
        url: The URL to validate.
        context: Description of the calling context for logging.

    Returns:
        The validated URL (unchanged).

    Raises:
        SSRFBlockedError: If the URL is blocked for any SSRF reason.
        ValueError: If the URL is malformed.
    """
    # 1. Parse URL
    try:
        parsed = urlparse(url)
    except Exception as exc:
        raise ValueError(f"Malformed URL: {url!r}") from exc

    # 2. Scheme validation
    scheme = parsed.scheme.lower()
    if scheme not in _ALLOWED_SCHEMES:
        logger.warning(
            "ssrf_blocked_scheme",
            url=url,
            scheme=scheme,
            context=context,
        )
        raise SSRFBlockedError(
            f"URL scheme '{scheme}' is not allowed. Only http and https are permitted.",
            context={"url": url, "scheme": scheme},
        )

    # 3. Hostname extraction
    hostname = parsed.hostname
    if not hostname:
        raise ValueError(f"URL has no hostname: {url!r}")

    hostname_lower = hostname.lower()

    # 4. Block known cloud metadata hostnames
    if hostname_lower in _CLOUD_METADATA_HOSTNAMES:
        logger.warning(
            "ssrf_blocked_metadata_host",
            url=url,
            hostname=hostname,
            context=context,
        )
        raise SSRFBlockedError(
            f"Host '{hostname}' is a cloud metadata endpoint and cannot be accessed.",
            context={"url": url, "hostname": hostname},
        )

    # Block literal 'localhost'
    if hostname_lower in ("localhost", "ip6-localhost", "ip6-loopback"):
        logger.warning(
            "ssrf_blocked_localhost",
            url=url,
            hostname=hostname,
            context=context,
        )
        raise SSRFBlockedError(
            f"Host '{hostname}' is not allowed.",
            context={"url": url, "hostname": hostname},
        )

    # 5. DNS resolution — resolve all addresses
    try:
        results = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        logger.warning(
            "ssrf_dns_resolution_failed",
            url=url,
            hostname=hostname,
            context=context,
        )
        raise SSRFBlockedError(
            f"Could not resolve hostname '{hostname}'.",
            context={"url": url, "hostname": hostname, "error": str(exc)},
        ) from exc

    # 6. Check all resolved IPs
    for result in results:
        family, _socktype, _proto, _canonname, sockaddr = result
        if family in (socket.AF_INET, socket.AF_INET6):
            ip_str = sockaddr[0]
            if is_ip_blocked(ip_str):
                logger.warning(
                    "ssrf_blocked_private_ip",
                    url=url,
                    hostname=hostname,
                    resolved_ip=ip_str,
                    context=context,
                )
                raise SSRFBlockedError(
                    f"Host '{hostname}' resolves to a private or reserved IP address "
                    f"and cannot be accessed.",
                    context={
                        "url": url,
                        "hostname": hostname,
                        "resolved_ip": ip_str,
                    },
                )

    logger.debug(
        "ssrf_url_validated",
        hostname=hostname,
        context=context,
    )
    return url


def validate_domain_allowlist(url: str, allowed_domains: list[str]) -> None:
    """
    Enforce an operator-configured domain allowlist.

    If ``allowed_domains`` is empty, all domains pass (open mode).
    If non-empty, the URL's hostname (and any www. variant) must appear
    in the list.

    Args:
        url: The URL whose hostname to check.
        allowed_domains: List of lowercase allowed hostnames.

    Raises:
        SSRFBlockedError: If the hostname is not in the allowlist.
    """
    if not allowed_domains:
        return  # open mode — allow everything that passes SSRF checks

    try:
        parsed = urlparse(url)
        hostname = (parsed.hostname or "").lower()
    except Exception:
        raise SSRFBlockedError(
            "Malformed URL — cannot validate against domain allowlist.",
            context={"url": url},
        )

    # Strip leading www. for comparison
    bare = hostname.removeprefix("www.")

    if hostname not in allowed_domains and bare not in allowed_domains:
        logger.warning(
            "domain_allowlist_blocked",
            url=url,
            hostname=hostname,
            allowed_domains=allowed_domains,
        )
        raise SSRFBlockedError(
            f"Domain '{hostname}' is not in the list of allowed domains configured "
            "for this platform. Contact your administrator to add it.",
            context={"url": url, "hostname": hostname, "allowed": allowed_domains},
        )
