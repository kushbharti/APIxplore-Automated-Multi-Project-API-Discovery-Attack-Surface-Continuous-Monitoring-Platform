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

import httpx
import structlog

from app.core.ssrf import validate_url_for_outbound
from app.core.exceptions import SSRFBlockedError

logger = structlog.get_logger(__name__)

# Maximum JS file size to analyze (2MB)
_MAX_JS_SIZE = 2 * 1024 * 1024

# Maximum number of JS files to analyze per discovery run
_MAX_JS_FILES = 20

# Regex patterns for API endpoint extraction
_PATTERNS: list[re.Pattern] = [
    # fetch("...") / fetch('...')
    re.compile(r"""fetch\s*\(\s*['"`]([/][^'"`\s]{1,500})['"`]"""),
    # axios.get/post/put/patch/delete("...")
    re.compile(r"""axios\s*\.\s*(?:get|post|put|patch|delete|head)\s*\(\s*['"`]([/][^'"`\s]{1,500})['"`]""", re.IGNORECASE),
    # $http.get/post("...")  (AngularJS)
    re.compile(r"""\$http\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*['"`]([/][^'"`\s]{1,500})['"`]""", re.IGNORECASE),
    # Vue/React api calls
    re.compile(r"""api\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*['"`]([/][^'"`\s]{1,500})['"`]""", re.IGNORECASE),
    # Direct string literals that look like API paths
    re.compile(r"""['"\`](/api/[^'"\`\s]{1,500})['"\`]"""),
    re.compile(r"""['"\`](/v\d+/[^'"\`\s]{1,500})['"\`]"""),
    re.compile(r"""['"\`](/rest/[^'"\`\s]{1,500})['"\`]"""),
    re.compile(r"""['"\`](/graphql[^'"\`\s]{0,200})['"\`]"""),

    # XMLHttpRequest patterns
    re.compile(r"""XMLHttpRequest[^;]{0,200}open\s*\(\s*['"](?:GET|POST|PUT|PATCH|DELETE)['"]\s*,\s*['"`]([/][^'"\`\s]{1,500})['"`]""", re.IGNORECASE),
    re.compile(r"""\.open\s*\(\s*['"](?:GET|POST|PUT|PATCH|DELETE)['"]\s*,\s*['"`]([/][^'"\`\s]{1,500})['"`]""", re.IGNORECASE),

    # SPA and client-side routing patterns
    re.compile(r"""navigate\s*\(\s*['"\`]([/][^'"\`\s]{1,500})['"\`]"""),
    re.compile(r"""router\.push\s*\(\s*['"\`]([/][^'"\`\s]{1,500})['"\`]"""),
    re.compile(r"""router\.replace\s*\(\s*['"\`]([/][^'"\`\s]{1,500})['"\`]"""),
    re.compile(r"""\$router\.push\s*\(\s*['"\`]([/][^'"\`\s]{1,500})['"\`]"""),

    # Window location assignments
    re.compile(r"""window\.location\.href\s*=\s*['"\`]([/][^'"\`\s]{1,500})['"\`]"""),
    re.compile(r"""window\.location\.assign\s*\(\s*['"\`]([/][^'"\`\s]{1,500})['"\`]"""),
    re.compile(r"""window\.location\.replace\s*\(\s*['"\`]([/][^'"\`\s]{1,500})['"\`]"""),
    re.compile(r"""location\.href\s*=\s*['"\`]([/][^'"\`\s]{1,500})['"\`]"""),

    # href / url assignments
    re.compile(r"""href\s*[:=]\s*['"\`]([/][^'"\`\s]{1,500})['"\`]"""),
    re.compile(r"""url\s*[:=]\s*['"\`]([/][^'"\`\s]{1,500})['"\`]"""),
]

# Method extraction alongside the URL
_METHOD_WITH_URL_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("GET", re.compile(r"""(?:fetch|axios\.get|api\.get|\$http\.get)\s*\(\s*['"`]([/][^'"`\s]+)['"`]""", re.IGNORECASE)),
    ("POST", re.compile(r"""(?:axios\.post|api\.post|\$http\.post)\s*\(\s*['"`]([/][^'"`\s]+)['"`]""", re.IGNORECASE)),
    ("PUT", re.compile(r"""(?:axios\.put|api\.put|\$http\.put)\s*\(\s*['"`]([/][^'"`\s]+)['"`]""", re.IGNORECASE)),
    ("PATCH", re.compile(r"""(?:axios\.patch|api\.patch|\$http\.patch)\s*\(\s*['"`]([/][^'"`\s]+)['"`]""", re.IGNORECASE)),
    ("DELETE", re.compile(r"""(?:axios\.delete|api\.delete|\$http\.delete)\s*\(\s*['"`]([/][^'"`\s]+)['"`]""", re.IGNORECASE)),
]

# Skip these paths — they're almost certainly assets, not APIs
_SKIP_PATH_PATTERNS = [
    re.compile(r"\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|ttf|eot|html|htm|txt|pdf)$", re.IGNORECASE),
    re.compile(r"^/static/"),
    re.compile(r"^/assets/"),
    re.compile(r"^/public/"),
    re.compile(r"^/images?/"),
    re.compile(r"^/fonts?/"),
    re.compile(r"^/icons?/"),
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
    return any(p.search(path) for p in _SKIP_PATH_PATTERNS)


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
