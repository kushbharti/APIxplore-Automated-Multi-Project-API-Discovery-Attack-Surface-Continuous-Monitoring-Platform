"""
app/discovery/verifier.py
==========================
Endpoint verification — tests discovered candidates with real HTTP requests.

For each candidate:
1. SSRF validation (always first)
2. GET request (HEAD often strips Content-Type; GET gives us the body for inspection)
3. Classify response using content-type + body analysis

Classification logic:
  VERIFIED      — JSON/API response (application/json, application/xml, etc.)
  WEB_PAGE      — HTML response — this is a webpage, NOT a monitorable API
  AUTH_REQUIRED — 401/403 with JSON body — endpoint exists but needs authentication
  UNAVAILABLE   — 404, 5xx, or connection errors
  BLOCKED       — SSRF blocked
  INVALID       — Malformed URL or unexpected error

Key principle: HTTP 200 alone does NOT mean an endpoint is an API.
The Content-Type and response body must be examined.

Bounds:
  - Max 10 concurrent verifications per run
  - 8s timeout per request
  - Max 256KB body read for content inspection
"""

from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass

import httpx
import structlog

from app.core.ssrf import validate_url_for_outbound
from app.core.exceptions import SSRFBlockedError

logger = structlog.get_logger(__name__)

# Timeout per verification request
_VERIFY_TIMEOUT = 8.0

# Max concurrent verifications
_MAX_CONCURRENT = 10

# Max body bytes to read for classification
_MAX_BODY_BYTES = 256 * 1024  # 256 KB

# Content-types that indicate an API (JSON, XML, protobuf, etc.)
_API_CONTENT_TYPES = {
    "application/json",
    "application/ld+json",
    "application/hal+json",
    "application/vnd.api+json",
    "application/problem+json",
    "application/xml",
    "application/atom+xml",
    "application/rss+xml",
    "text/xml",
    "text/csv",
    "application/x-ndjson",
    "application/x-msgpack",
    "application/octet-stream",
}

# Content-types that indicate a web page (never an API)
_HTML_CONTENT_TYPES = {
    "text/html",
    "application/xhtml+xml",
    "text/xhtml",
}

# Patterns in URL paths that strongly suggest API routes
_API_PATH_PATTERNS = [
    re.compile(r"/api/", re.IGNORECASE),
    re.compile(r"/v\d+/", re.IGNORECASE),
    re.compile(r"/graphql", re.IGNORECASE),
    re.compile(r"/rest/", re.IGNORECASE),
    re.compile(r"/gql\b", re.IGNORECASE),
    re.compile(r"\.json$", re.IGNORECASE),
    re.compile(r"\.xml$", re.IGNORECASE),
]

# HTML detection patterns in body
_HTML_BODY_PATTERNS = re.compile(
    r"<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]",
    re.IGNORECASE,
)


def _extract_content_type_base(content_type: str) -> str:
    """Extract the base MIME type, ignoring charset/boundary parameters."""
    if not content_type:
        return ""
    return content_type.split(";")[0].strip().lower()


def _is_api_content_type(ct_base: str) -> bool:
    """Return True if the content-type indicates an API response."""
    if ct_base in _API_CONTENT_TYPES:
        return True
    # application/vnd.* is typically a REST/HAL API
    if ct_base.startswith("application/vnd."):
        return True
    return False


def _is_html_content_type(ct_base: str) -> bool:
    """Return True if the content-type indicates an HTML page."""
    return ct_base in _HTML_CONTENT_TYPES


def _body_looks_like_json(body: str) -> bool:
    """Quick heuristic: does the body start with a JSON value?"""
    stripped = body.lstrip()
    if not stripped:
        return False
    return stripped[0] in ("{", "[", '"') or stripped.startswith(("true", "false", "null"))


def _body_looks_like_html(body: str) -> bool:
    """Return True if the body contains HTML markers."""
    return bool(_HTML_BODY_PATTERNS.search(body[:4096]))


def _classify_verification(
    http_status: int,
    content_type: str,
    body_sample: str,
    url: str,
    source: str = "",
) -> str:
    """
    Determine the VerificationStatus for a completed HTTP response.

    Args:
        http_status:   The HTTP status code received.
        content_type:  The full Content-Type header value.
        body_sample:   First few KB of the response body.
        url:           The URL that was checked (for path analysis).
        source:        Discovery source hint (e.g. "OPENAPI").

    Returns:
        A VerificationStatus string value.
    """
    ct_base = _extract_content_type_base(content_type)

    # -----------------------------------------------------------------
    # OpenAPI-sourced endpoints: trust the spec even without JSON body
    # -----------------------------------------------------------------
    if source == "OPENAPI":
        if http_status == 404:
            return "UNAVAILABLE"
        if http_status in (401, 403):
            return "AUTH_REQUIRED"
        if http_status in range(200, 500):
            # OpenAPI spec is authoritative — endpoint exists
            return "VERIFIED"
        return "UNAVAILABLE"

    # -----------------------------------------------------------------
    # 401 / 403 — endpoint exists but needs authentication
    # -----------------------------------------------------------------
    if http_status in (401, 403):
        # Only mark AUTH_REQUIRED if there's JSON evidence or API path
        from urllib.parse import urlparse
        path = urlparse(url).path
        has_api_path = any(p.search(path) for p in _API_PATH_PATTERNS)
        is_json_ct = _is_api_content_type(ct_base) or "json" in ct_base
        body_json = _body_looks_like_json(body_sample)
        if is_json_ct or body_json or has_api_path:
            return "AUTH_REQUIRED"
        return "UNAVAILABLE"

    # -----------------------------------------------------------------
    # 404 — endpoint does not exist at this path
    # -----------------------------------------------------------------
    if http_status == 404:
        return "UNAVAILABLE"

    # -----------------------------------------------------------------
    # 405 Method Not Allowed — endpoint exists, wrong method
    # -----------------------------------------------------------------
    if http_status == 405:
        return "AUTH_REQUIRED"  # Exists, just reachable differently

    # -----------------------------------------------------------------
    # 2xx responses — inspect content-type and body
    # -----------------------------------------------------------------
    if http_status in range(200, 300):
        # HTML content-type → web page, not an API
        if _is_html_content_type(ct_base):
            return "WEB_PAGE"
        # Body looks like HTML even if content-type is ambiguous
        if _body_looks_like_html(body_sample):
            return "WEB_PAGE"
        # Confirmed API content-type
        if _is_api_content_type(ct_base):
            return "VERIFIED"
        # JSON body even with generic content-type (e.g. text/plain)
        if _body_looks_like_json(body_sample):
            return "VERIFIED"
        # text/plain with no JSON — ambiguous; check path pattern
        from urllib.parse import urlparse
        path = urlparse(url).path
        if any(p.search(path) for p in _API_PATH_PATTERNS):
            return "VERIFIED"
        # Empty body with 2xx — could be API or page; be conservative
        if not body_sample.strip():
            return "VERIFIED"
        # Default: treat as web page when no API evidence
        return "WEB_PAGE"

    # -----------------------------------------------------------------
    # 3xx redirects (follow_redirects=True so we shouldn't hit these)
    # -----------------------------------------------------------------
    if http_status in range(300, 400):
        return "UNAVAILABLE"

    # -----------------------------------------------------------------
    # 5xx server errors — endpoint may exist but is broken
    # -----------------------------------------------------------------
    if http_status in range(500, 600):
        return "UNAVAILABLE"

    # -----------------------------------------------------------------
    # Anything else
    # -----------------------------------------------------------------
    return "UNAVAILABLE"


@dataclass
class VerificationResult:
    """Result of verifying one candidate endpoint."""
    url: str
    method: str
    status: str  # VERIFIED | WEB_PAGE | AUTH_REQUIRED | UNAVAILABLE | BLOCKED | INVALID
    http_status: int | None = None
    response_time_ms: float | None = None
    content_type: str | None = None
    error: str | None = None


async def verify_endpoint(
    url: str,
    method: str = "GET",
    source: str = "",
    client: httpx.AsyncClient | None = None,
) -> VerificationResult:
    """
    Verify a single endpoint candidate.

    Uses GET to inspect the actual response body and content-type.
    HEAD is NOT used because it often omits Content-Type and body.

    Args:
        url:    Full URL to verify.
        method: HTTP method originally discovered (informational only).
        source: Discovery source (e.g. "OPENAPI") for classification hints.
        client: Optional shared httpx client.

    Returns:
        VerificationResult with classification and timing.
    """
    # 1. SSRF check — always first
    try:
        validate_url_for_outbound(url, context="verification")
    except SSRFBlockedError as exc:
        return VerificationResult(url=url, method=method, status="BLOCKED", error=str(exc))
    except ValueError as exc:
        return VerificationResult(url=url, method=method, status="INVALID", error=str(exc))

    # 2. HTTP request
    should_close = client is None
    if client is None:
        client = httpx.AsyncClient(
            timeout=_VERIFY_TIMEOUT,
            follow_redirects=True,
            max_redirects=3,
            headers={"User-Agent": "APIMonitor-Verifier/1.0"},
            limits=httpx.Limits(max_connections=20),
        )

    try:
        # Use GET for safe methods to get body (needed for classification)
        # Use HEAD only for non-idempotent methods to avoid side effects
        probe_method = "GET" if method in ("GET", "HEAD", "OPTIONS") else "HEAD"

        start = time.perf_counter()
        response = await client.request(
            probe_method,
            url,
            headers={"Accept": "application/json, text/html, */*;q=0.8"},
        )
        elapsed_ms = (time.perf_counter() - start) * 1000

        http_status = response.status_code
        content_type = response.headers.get("content-type", "")

        # Read up to _MAX_BODY_BYTES for classification
        body_sample = ""
        try:
            body_bytes = response.content[:_MAX_BODY_BYTES]
            body_sample = body_bytes.decode("utf-8", errors="replace")
        except Exception:
            body_sample = ""

        status = _classify_verification(
            http_status=http_status,
            content_type=content_type,
            body_sample=body_sample,
            url=url,
            source=source,
        )

        return VerificationResult(
            url=url,
            method=method,
            status=status,
            http_status=http_status,
            response_time_ms=round(elapsed_ms, 1),
            content_type=_extract_content_type_base(content_type) or None,
        )

    except httpx.TimeoutException:
        return VerificationResult(url=url, method=method, status="UNAVAILABLE", error="TIMEOUT")
    except httpx.ConnectError as exc:
        return VerificationResult(
            url=url, method=method, status="UNAVAILABLE",
            error=f"CONNECTION_ERROR: {str(exc)[:100]}"
        )
    except SSRFBlockedError as exc:
        return VerificationResult(url=url, method=method, status="BLOCKED", error=str(exc))
    except Exception as exc:
        logger.debug("verification_unexpected_error", url=url, error=str(exc))
        return VerificationResult(
            url=url, method=method, status="INVALID", error=str(exc)[:200]
        )
    finally:
        if should_close:
            await client.aclose()


async def verify_batch(
    candidates: list[tuple[str, str, str]],  # list of (url, method, source)
) -> list[VerificationResult]:
    """
    Verify multiple candidates concurrently with bounded parallelism.

    Args:
        candidates: List of (url, method, source) tuples.

    Returns:
        List of VerificationResult in the same order.
    """
    semaphore = asyncio.Semaphore(_MAX_CONCURRENT)

    async with httpx.AsyncClient(
        timeout=_VERIFY_TIMEOUT,
        follow_redirects=True,
        max_redirects=3,
        headers={"User-Agent": "APIMonitor-Verifier/1.0"},
        limits=httpx.Limits(max_connections=_MAX_CONCURRENT + 5),
    ) as client:

        async def verify_with_semaphore(
            url: str, method: str, source: str
        ) -> VerificationResult:
            async with semaphore:
                return await verify_endpoint(url, method, source=source, client=client)

        tasks = [
            verify_with_semaphore(url, method, source)
            for url, method, source in candidates
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    # Convert exceptions to INVALID results
    final: list[VerificationResult] = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            url, method, _ = candidates[i]
            final.append(VerificationResult(
                url=url, method=method, status="INVALID",
                error=str(result)[:200],
            ))
        else:
            final.append(result)

    return final
