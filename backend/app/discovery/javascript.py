"""
app/discovery/javascript.py
============================
JavaScript analysis provider for API endpoint discovery.

Downloads publicly accessible JavaScript files and extracts
API endpoint patterns using regex matching.

Patterns recognized:
  fetch("/api/products")
  axios.get("/api/products")
  axios.post("/api/orders")
  $http.get("/api/users")
  api.get("/v1/items")
  "/api/some-path"  (direct string)

Confidence: MEDIUM
All candidates must go through the verifier before being used.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field
from urllib.parse import urlparse

import httpx
import structlog

from app.core.ssrf import validate_url_for_outbound
from app.core.exceptions import SSRFBlockedError

logger = structlog.get_logger(__name__)

# Maximum JS file size to analyze (2MB)
_MAX_JS_SIZE = 2 * 1024 * 1024

# Maximum number of JS files to analyze per discovery run
_MAX_JS_FILES = 25

# Regex patterns for API endpoint extraction (supports relative paths and absolute backend URLs)
_PATTERNS: list[re.Pattern] = [
    # fetch("/api/...") / fetch('...')
    re.compile(r"""fetch\s*\(\s*['"`]((?:/|https?://)[^'"`\s]{1,500})['"`]"""),
    # axios.get/post/put/patch/delete("...")
    re.compile(r"""axios\s*\.\s*(?:get|post|put|patch|delete|head)\s*\(\s*['"`]((?:/|https?://)[^'"`\s]{1,500})['"`]""", re.IGNORECASE),
    # $http.get/post("...")  (AngularJS)
    re.compile(r"""\$http\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*['"`]((?:/|https?://)[^'"`\s]{1,500})['"`]""", re.IGNORECASE),
    # Vue/React api calls
    re.compile(r"""api\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*['"`]((?:/|https?://)[^'"`\s]{1,500})['"`]""", re.IGNORECASE),
    # Direct string literals that look like API paths or API URLs
    re.compile(r"""['"\`]((?:/api/|https?://[^'"\`\s]+/api/)[^'"\`\s]{1,500})['"\`]"""),
    re.compile(r"""['"\`]((?:/v\d+/|https?://[^'"\`\s]+/v\d+/)[^'"\`\s]{1,500})['"\`]"""),
    re.compile(r"""['"\`]((?:/rest/|https?://[^'"\`\s]+/rest/)[^'"\`\s]{1,500})['"\`]"""),
    re.compile(r"""['"\`]((?:/graphql|https?://[^'"\`\s]+/graphql)[^'"\`\s]{0,200})['"\`]"""),

    # XMLHttpRequest patterns
    re.compile(r"""XMLHttpRequest[^;]{0,200}open\s*\(\s*['"](?:GET|POST|PUT|PATCH|DELETE)['"]\s*,\s*['"`]((?:/|https?://)[^'"\`\s]{1,500})['"`]""", re.IGNORECASE),
    re.compile(r"""\.open\s*\(\s*['"](?:GET|POST|PUT|PATCH|DELETE)['"]\s*,\s*['"`]((?:/|https?://)[^'"\`\s]{1,500})['"`]""", re.IGNORECASE),

    # API request configuration properties (url / endpoint / path) that look like API routes
    re.compile(r"""(?:url|endpoint|path)\s*[:=]\s*['"\`]((?:/|https?://)(?:api/|v\d+/|rest/|graphql/|[a-zA-Z0-9_.-]{2,}/)[^'"\`\s]*)['"\`]""", re.IGNORECASE),
]

# Method extraction alongside the URL
_METHOD_WITH_URL_PATTERNS: list[tuple[str, re.Pattern]] = [
    # fetch with options method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    ("POST", re.compile(r"""fetch\s*\(\s*['"`]((?:/|https?://)[^'"`\s]+)['"`][^,)]*,\s*\{[^}]*?method\s*:\s*['"]POST['"]""", re.IGNORECASE)),
    ("PUT", re.compile(r"""fetch\s*\(\s*['"`]((?:/|https?://)[^'"`\s]+)['"`][^,)]*,\s*\{[^}]*?method\s*:\s*['"]PUT['"]""", re.IGNORECASE)),
    ("PATCH", re.compile(r"""fetch\s*\(\s*['"`]((?:/|https?://)[^'"`\s]+)['"`][^,)]*,\s*\{[^}]*?method\s*:\s*['"]PATCH['"]""", re.IGNORECASE)),
    ("DELETE", re.compile(r"""fetch\s*\(\s*['"`]((?:/|https?://)[^'"`\s]+)['"`][^,)]*,\s*\{[^}]*?method\s*:\s*['"]DELETE['"]""", re.IGNORECASE)),
    # Client method shortcuts
    ("POST", re.compile(r"""(?:axios\.post|api\.post|\$http\.post)\s*\(\s*['"`]((?:/|https?://)[^'"`\s]+)['"`]""", re.IGNORECASE)),
    ("PUT", re.compile(r"""(?:axios\.put|api\.put|\$http\.put)\s*\(\s*['"`]((?:/|https?://)[^'"`\s]+)['"`]""", re.IGNORECASE)),
    ("PATCH", re.compile(r"""(?:axios\.patch|api\.patch|\$http\.patch)\s*\(\s*['"`]((?:/|https?://)[^'"`\s]+)['"`]""", re.IGNORECASE)),
    ("DELETE", re.compile(r"""(?:axios\.delete|api\.delete|\$http\.delete)\s*\(\s*['"`]((?:/|https?://)[^'"`\s]+)['"`]""", re.IGNORECASE)),
    # GET queries
    ("GET", re.compile(r"""(?:fetch|axios\.get|api\.get|\$http\.get)\s*\(\s*['"`]((?:/|https?://)[^'"`\s]+)['"`]""", re.IGNORECASE)),
]

# Skip these paths — they're almost certainly assets, not APIs
_SKIP_PATH_PATTERNS = [
    re.compile(r"\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|html|htm|txt|pdf|map|jsonld)$", re.IGNORECASE),
    re.compile(r"^/static/"),
    re.compile(r"^/assets/"),
    re.compile(r"^/public/"),
    re.compile(r"^/images?/"),
    re.compile(r"^/fonts?/"),
    re.compile(r"^/icons?/"),
    re.compile(r"^/favicon"),
]


@dataclass
class JSEndpoint:
    """An endpoint candidate extracted from JavaScript."""
    method: str
    path: str


@dataclass
class JSAnalysisResult:
    """Result from JavaScript analysis."""
    js_files_analyzed: int = 0
    endpoints: list[JSEndpoint] = field(default_factory=list)
    error: str | None = None


def _should_skip_path(path: str) -> bool:
    """Return True if this path should not be treated as an API endpoint."""
    if not path or path in ("/", "#", "/#", "javascript:void(0)", "void(0)"):
        return True
    if path.startswith(("http://", "https://")):
        try:
            parsed = urlparse(path)
            if not parsed.netloc:
                return True
            check_path = parsed.path
        except Exception:
            return True
    else:
        check_path = path

    cleaned = check_path.strip("/")
    # Filter out single-letter or empty paths (e.g. /a, /b, /x)
    if len(cleaned) < 2:
        return True
    if len(cleaned) == 2 and cleaned not in ("me", "ip", "id", "ws", "ui"):
        return True

    return any(p.search(check_path) for p in _SKIP_PATH_PATTERNS)


def _extract_from_js(content: str) -> list[JSEndpoint]:
    """Extract API endpoint candidates from JavaScript source code."""
    found: dict[tuple[str, str], JSEndpoint] = {}

    # Method-aware extraction
    for method, pattern in _METHOD_WITH_URL_PATTERNS:
        for match in pattern.finditer(content):
            path = match.group(1).strip()
            if _should_skip_path(path):
                continue
            key = (method, path)
            if key not in found:
                found[key] = JSEndpoint(method=method, path=path)

    # General path extraction (assume GET if method unclear)
    for pattern in _PATTERNS:
        for match in pattern.finditer(content):
            path = match.group(1).strip()
            if _should_skip_path(path):
                continue
            # Default to GET for unresolved methods
            key = ("GET", path)
            if key not in found:
                found[key] = JSEndpoint(method="GET", path=path)

    return list(found.values())


async def analyze_javascript(js_urls: list[str], base_url: str) -> JSAnalysisResult:
    """
    Analyze JavaScript files for API endpoint patterns.
    Downloads all JS files concurrently (up to _MAX_JS_FILES) then extracts
    endpoint candidates from each.

    Args:
        js_urls: List of JS file URLs to analyze.
        base_url: Base URL of the project (for building full URLs).

    Returns:
        JSAnalysisResult with discovered endpoint paths.
    """
    if not js_urls:
        return JSAnalysisResult()

    urls_to_analyze = list(dict.fromkeys(js_urls))[:_MAX_JS_FILES]  # deduplicate, cap
    all_endpoints: dict[tuple[str, str], JSEndpoint] = {}
    files_analyzed = 0

    semaphore = asyncio.Semaphore(6)

    async with httpx.AsyncClient(
        timeout=10.0,
        follow_redirects=True,
        max_redirects=2,
        headers={"User-Agent": "APIMonitor-Discovery/1.0 (js-analyzer)"},
        limits=httpx.Limits(max_connections=6),
    ) as client:

        async def fetch_and_analyze(js_url: str) -> list[JSEndpoint]:
            try:
                validate_url_for_outbound(js_url, context="js_analysis")
            except (SSRFBlockedError, ValueError):
                return []
            try:
                async with semaphore:
                    response = await client.get(js_url)
                if response.status_code != 200:
                    return []
                if len(response.content) > _MAX_JS_SIZE:
                    logger.debug("js_file_too_large", url=js_url, size=len(response.content))
                    return []
                endpoints = _extract_from_js(response.text)
                logger.debug("js_analyzed", url=js_url, endpoints_found=len(endpoints))
                return endpoints
            except SSRFBlockedError:
                return []
            except (httpx.TimeoutException, httpx.ConnectError):
                return []
            except Exception as exc:
                logger.debug("js_analysis_error", url=js_url, error=str(exc))
                return []

        tasks = [fetch_and_analyze(url) for url in urls_to_analyze]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for endpoints in results:
            if isinstance(endpoints, list) and endpoints:
                files_analyzed += 1
                for ep in endpoints:
                    key = (ep.method, ep.path)
                    if key not in all_endpoints:
                        all_endpoints[key] = ep

    return JSAnalysisResult(
        js_files_analyzed=files_analyzed,
        endpoints=list(all_endpoints.values()),
    )
