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
from urllib.parse import urlparse

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
    "application/graphql-response+json",
}

# Content-types that indicate an HTML page (never an API)
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
    re.compile(r"/rpc/", re.IGNORECASE),
    re.compile(r"/gql\b", re.IGNORECASE),
    re.compile(r"\.json$", re.IGNORECASE),
    re.compile(r"\.xml$", re.IGNORECASE),
]

# HTML detection patterns in body
_HTML_BODY_PATTERNS = re.compile(
    r"<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]",
    re.IGNORECASE,
)

# SPA shell signatures (served by try_files $uri /index.html)
_SPA_SHELL_PATTERNS = [
    re.compile(r'<div\s+id=["\'](?:root|app|__next|__nuxt|mount)["\']', re.IGNORECASE),
    re.compile(r'<script\s+[^>]*src=["\'][^"\']*(?:/static/js/|/assets/|chunk)[^"\']*["\']', re.IGNORECASE),
]

# HTML error page signatures (Nginx 404/500, Cloudflare, Apache, generic error pages)
_HTML_ERROR_PATTERNS = [
    re.compile(r"<title>\s*(?:404|500|502|503|504|Error|Page Not Found|Not Found|Bad Gateway|Internal Server Error)", re.IGNORECASE),
    re.compile(r"<h1>\s*(?:404|500|502|503|504|Error|Page Not Found|Not Found|Bad Gateway|Internal Server Error)", re.IGNORECASE),
    re.compile(r"cloudflare\s+(?:ray\s+id|error|attention\s+required)", re.IGNORECASE),
]

# Auth/Login redirect paths
_AUTH_PATH_PATTERNS = [
    re.compile(r"/(?:login|signin|sign-in|auth|oauth|authorize|sso)(?:/|$|\?)", re.IGNORECASE),
]


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


def _is_spa_fallback(body: str) -> bool:
    """Return True if the HTML body looks like an SPA fallback shell (e.g. index.html)."""
    sample = body[:8192]
    return any(p.search(sample) for p in _SPA_SHELL_PATTERNS)


def _is_html_error_page(body: str) -> bool:
    """Return True if the HTML body contains standard HTML error markers."""
    sample = body[:8192]
    return any(p.search(sample) for p in _HTML_ERROR_PATTERNS)


def _is_auth_redirect(final_url: str) -> bool:
    """Return True if the final redirected URL points to an authentication or login page."""
    parsed = urlparse(final_url)
    if any(p.search(parsed.path) for p in _AUTH_PATH_PATTERNS):
        return True
    if parsed.netloc.startswith(("auth.", "login.", "sso.", "accounts.")):
        return True
    return False


def _is_home_redirect(initial_url: str, final_url: str) -> bool:
    """Return True if an API request was redirected to the root or home landing page."""
    init_parsed = urlparse(initial_url)
    fin_parsed = urlparse(final_url)
    init_path = init_parsed.path.rstrip("/")
    fin_path = fin_parsed.path.rstrip("/")
    if init_path and (not fin_path or fin_path in ("/home", "/index.html")):
        return True
    return False


def _classify_verification(
    http_status: int,
    content_type: str,
    body_sample: str,
    url: str,
    method: str = "GET",
    source: str = "",
    redirect_count: int = 0,
    final_url: str | None = None,
) -> tuple[str, str | None]:
    """
    Determine the VerificationStatus and diagnostic note for a completed HTTP response.

    Args:
        http_status:    The HTTP status code received.
        content_type:   The full Content-Type header value.
        body_sample:    First few KB of the response body.
        url:            The URL that was probed.
        method:         The discovered HTTP method of the endpoint candidate.
        source:         Discovery source hint (e.g. "OPENAPI").
        redirect_count: Number of redirects followed.
        final_url:      Final URL after following redirects.

    Returns:
        tuple[VerificationStatus, diagnostic_note]
    """
    ct_base = _extract_content_type_base(content_type)
    resolved_final = final_url or url

    # -----------------------------------------------------------------
    # OpenAPI-sourced endpoints: trust the spec documentation first
    # (checked before redirect heuristics so spec endpoints aren't
    # wrongly dismissed because of CORS/middleware redirects)
    # -----------------------------------------------------------------
    if source == "OPENAPI":
        if http_status == 404:
            # If the path has parameters (e.g. /users/{id}) or returns an API/JSON response,
            # 404 means the entity/sample ID was not found in the DB, but the API endpoint route exists!
            parsed_path = urlparse(url).path
            has_path_params = "{" in parsed_path or ":" in parsed_path
            if has_path_params or _is_api_content_type(ct_base) or _body_looks_like_json(body_sample):
                return "VERIFIED", f"OpenAPI endpoint confirmed (HTTP 404 for sample parameter on {method})"
            return "UNAVAILABLE", "OpenAPI endpoint returned 404 Not Found"
        if http_status in (401, 403):
            return "AUTH_REQUIRED", f"OpenAPI endpoint requires authentication (HTTP {http_status})"
        if http_status in (405, 422):
            return "VERIFIED", f"OpenAPI endpoint confirmed by server (HTTP {http_status})"
        if http_status in range(200, 500):
            return "VERIFIED", f"OpenAPI endpoint verified (HTTP {http_status})"
        return "UNAVAILABLE", f"OpenAPI endpoint server error (HTTP {http_status})"

    # -----------------------------------------------------------------
    # Redirect Analysis (non-OpenAPI endpoints)
    # -----------------------------------------------------------------
    if redirect_count > 0 and final_url:
        if _is_auth_redirect(final_url):
            return "AUTH_REQUIRED", f"Redirected ({redirect_count} hops) to authentication page: {final_url}"
        # Only classify as WEB_PAGE if the final response isn't API data
        if _is_home_redirect(url, final_url):
            if not (_is_api_content_type(ct_base) or _body_looks_like_json(body_sample)):
                return "WEB_PAGE", f"Redirected ({redirect_count} hops) to landing page: {final_url}"

    # -----------------------------------------------------------------
    # 401 / 403 — endpoint exists but needs authentication
    # -----------------------------------------------------------------
    if http_status in (401, 403):
        path = urlparse(url).path
        has_api_path = any(p.search(path) for p in _API_PATH_PATTERNS)
        is_json_ct = _is_api_content_type(ct_base) or "json" in ct_base
        body_json = _body_looks_like_json(body_sample)
        if is_json_ct or body_json or has_api_path:
            return "AUTH_REQUIRED", f"Authentication required (HTTP {http_status})"
        return "UNAVAILABLE", f"Access denied (HTTP {http_status})"

    # -----------------------------------------------------------------
    # 405 Method Not Allowed — endpoint exists on router!
    # Probing with safe GET on a POST/PUT/PATCH/DELETE route confirms route.
    # -----------------------------------------------------------------
    if http_status == 405:
        target_method = method.upper()
        if target_method != "GET":
            return "VERIFIED", f"Route confirmed via HTTP 405 Method Not Allowed (endpoint accepts {target_method})"
        return "VERIFIED", "Route exists on server (HTTP 405 Method Not Allowed for GET)"

    # -----------------------------------------------------------------
    # 400 / 422 — Validation errors confirm API route existence
    # -----------------------------------------------------------------
    if http_status in (400, 422):
        if _is_api_content_type(ct_base) or _body_looks_like_json(body_sample):
            return "VERIFIED", f"Route confirmed via HTTP {http_status} API validation error"
        return "UNAVAILABLE", f"HTTP {http_status} Bad Request"

    # -----------------------------------------------------------------
    # 404 — endpoint does not exist at this path
    # -----------------------------------------------------------------
    if http_status == 404:
        return "UNAVAILABLE", "HTTP 404 Not Found"

    # -----------------------------------------------------------------
    # 5xx server errors
    # -----------------------------------------------------------------
    if http_status in range(500, 600):
        if _is_html_error_page(body_sample):
            return "UNAVAILABLE", f"HTML error page returned (HTTP {http_status})"
        return "UNAVAILABLE", f"Server error (HTTP {http_status})"

    # -----------------------------------------------------------------
    # 2xx responses — inspect content-type and body
    # -----------------------------------------------------------------
    if http_status in range(200, 300):
        # Masked HTML error page returning HTTP 200
        if _is_html_error_page(body_sample):
            return "UNAVAILABLE", f"Server returned HTML error page with HTTP {http_status}"

        # SPA fallback shell (catch-all index.html served for missing route)
        if _is_spa_fallback(body_sample):
            return "WEB_PAGE", "SPA fallback detected (catch-all index.html served for route)"

        # HTML content-type
        if _is_html_content_type(ct_base):
            path = urlparse(url).path
            # Ordinary webpage without API path pattern
            if not any(p.search(path) for p in _API_PATH_PATTERNS):
                return "WEB_PAGE", "Ordinary HTML webpage"
            # API path returning full HTML document
            if _body_looks_like_html(body_sample):
                return "WEB_PAGE", "HTML document returned for API route"
            # API path returning HTML data fragment
            return "VERIFIED", "HTML data response"

        # Body looks like HTML even with generic/missing content-type
        if _body_looks_like_html(body_sample):
            return "WEB_PAGE", "HTML page response"

        # Confirmed API content-type
        if _is_api_content_type(ct_base):
            return "VERIFIED", f"Verified API response (HTTP {http_status}, {ct_base})"

        # JSON body even with generic content-type (e.g. text/plain)
        if _body_looks_like_json(body_sample):
            return "VERIFIED", f"Verified JSON response (HTTP {http_status})"

        # Empty body with 204 No Content or 2xx on API path
        path = urlparse(url).path
        has_api_path = any(p.search(path) for p in _API_PATH_PATTERNS)
        if http_status == 204 or not body_sample.strip():
            if has_api_path or method.upper() != "GET":
                return "VERIFIED", f"Verified API response (HTTP {http_status} empty body)"
            return "VERIFIED", f"Empty response (HTTP {http_status})"

        if has_api_path:
            return "VERIFIED", "API route response"

        return "WEB_PAGE", "Non-API response"

    # -----------------------------------------------------------------
    # 3xx unresolved redirects
    # -----------------------------------------------------------------
    if http_status in range(300, 400):
        return "UNAVAILABLE", f"Unresolved redirect (HTTP {http_status})"

    return "UNAVAILABLE", f"Unexpected HTTP status {http_status}"


@dataclass
class VerificationResult:
    """Result of verifying one candidate endpoint."""
    url: str
    method: str
    status: str  # VERIFIED | WEB_PAGE | AUTH_REQUIRED | UNAVAILABLE | BLOCKED | INVALID
    http_status: int | None = None
    response_time_ms: float | None = None
    content_type: str | None = None
    redirect_count: int = 0
    final_url: str | None = None
    diagnostic_notes: str | None = None
    error: str | None = None


async def verify_endpoint(
    url: str,
    method: str = "GET",
    source: str = "",
    client: httpx.AsyncClient | None = None,
    headers: dict[str, str] | None = None,
) -> VerificationResult:
    """
    Verify a single endpoint candidate.

    Uses safe non-destructive probing to inspect response headers, body,
    redirect history, and status codes.

    Args:
        url:     Full URL to verify.
        method:  HTTP method originally discovered.
        source:  Discovery source (e.g. "OPENAPI") for classification hints.
        client:  Optional shared httpx client.
        headers: Optional auth headers for login-protected target probing.

    Returns:
        VerificationResult with classification, timing, and diagnostic notes.
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
        client_headers = {"User-Agent": "APIMonitor-Verifier/1.0"}
        if headers:
            client_headers.update(headers)
        client = httpx.AsyncClient(
            timeout=_VERIFY_TIMEOUT,
            follow_redirects=True,
            max_redirects=5,
            headers=client_headers,
            limits=httpx.Limits(max_connections=20),
        )

    try:
        # Non-destructive probe: GET is safe and idempotent.
        # For non-GET methods (POST, PUT, PATCH, DELETE), probing with GET gives response
        # headers and body without triggering side effects. If server returns 405, it confirms the route.
        probe_method = "GET" if method.upper() in ("GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE") else "GET"

        req_headers = {"Accept": "application/json, text/html, */*;q=0.8"}
        if headers:
            req_headers.update(headers)

        # For parameterized paths like /api/users/{id} or /api/items/:id,
        # instantiate dummy parameter values for the probe request so HTTP client
        # doesn't send raw curly braces to the server, while preserving original canonical URL.
        probe_url = re.sub(r"\{[^{}]+\}", "1", url)
        probe_url = re.sub(r"(?<=/):([a-zA-Z0-9_-]+)", "1", probe_url)

        start = time.perf_counter()
        response = await client.request(
            probe_method,
            probe_url,
            headers=req_headers,
        )
        elapsed_ms = (time.perf_counter() - start) * 1000

        # SSRF validation on redirect history
        for hist in response.history:
            if hist.next_request:
                try:
                    validate_url_for_outbound(str(hist.next_request.url), context="verification_redirect")
                except SSRFBlockedError as exc:
                    return VerificationResult(
                        url=url, method=method, status="BLOCKED", error=f"Redirect blocked: {exc}"
                    )

        http_status = response.status_code
        content_type = response.headers.get("content-type", "")

        # Read up to _MAX_BODY_BYTES for classification
        body_sample = ""
        try:
            body_bytes = response.content[:_MAX_BODY_BYTES]
            body_sample = body_bytes.decode("utf-8", errors="replace")
        except Exception:
            body_sample = ""

        redirect_count = len(response.history)
        final_url = str(response.url)

        status, note = _classify_verification(
            http_status=http_status,
            content_type=content_type,
            body_sample=body_sample,
            url=url,
            method=method,
            source=source,
            redirect_count=redirect_count,
            final_url=final_url,
        )

        return VerificationResult(
            url=url,
            method=method,
            status=status,
            http_status=http_status,
            response_time_ms=round(elapsed_ms, 1),
            content_type=_extract_content_type_base(content_type) or None,
            redirect_count=redirect_count,
            final_url=final_url,
            diagnostic_notes=note,
            error=note if status != "VERIFIED" else None,
        )

    except httpx.TooManyRedirects:
        return VerificationResult(
            url=url, method=method, status="UNAVAILABLE", error="TOO_MANY_REDIRECTS"
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
    headers: dict[str, str] | None = None,
) -> list[VerificationResult]:
    """
    Verify multiple candidates concurrently with bounded parallelism.

    Args:
        candidates: List of (url, method, source) tuples.
        headers:    Optional auth headers for login-protected target probing.

    Returns:
        List of VerificationResult in the same order.
    """
    semaphore = asyncio.Semaphore(_MAX_CONCURRENT)

    client_headers = {"User-Agent": "APIMonitor-Verifier/1.0"}
    if headers:
        client_headers.update(headers)

    async with httpx.AsyncClient(
        timeout=_VERIFY_TIMEOUT,
        follow_redirects=True,
        max_redirects=3,
        headers=client_headers,
        limits=httpx.Limits(max_connections=_MAX_CONCURRENT + 5),
    ) as client:

        async def verify_with_semaphore(
            url: str, method: str, source: str
        ) -> VerificationResult:
            async with semaphore:
                return await verify_endpoint(url, method, source=source, client=client, headers=headers)

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
