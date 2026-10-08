"""
app/discovery/crawler.py
=========================
Website crawler for endpoint discovery.

Performs a bounded BFS crawl of the target website to discover
ALL reachable internal links, classified by resource type.

Discovery order:
1. Probe robots.txt for Sitemap directives
2. Probe sitemap.xml / sitemap_index.xml for seed URLs
3. BFS crawl from target URL (concurrent per-level)

Classification of discovered paths:
- api   — matches /api/, /v1/, /graphql, etc. OR responds with JSON content-type
- json  — responds with application/json content-type
- page  — HTML page (navigation links, sub-pages, repository links, etc.)
- form  — form action URL

Safety constraints:
- Maximum crawl depth (default: 3)
- Maximum pages (default: 100)
- Same-domain only (never follows external links)
- Request timeout: 8 seconds per page
- Concurrency limit: 10 concurrent requests
- Response size limit: 5MB
- Duplicate URL elimination
- Loop prevention via visited set
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field
from typing import Callable, Awaitable, Any
from urllib.parse import urljoin, urlparse, urlunparse

import httpx
import structlog

from app.core.ssrf import validate_url_for_outbound
from app.core.exceptions import SSRFBlockedError

logger = structlog.get_logger(__name__)

# Patterns that mark a path as an API endpoint
_API_PATH_PATTERNS = [
    re.compile(r"/api/", re.IGNORECASE),
    re.compile(r"/v\d+/", re.IGNORECASE),
    re.compile(r"/rest/", re.IGNORECASE),
    re.compile(r"/graphql", re.IGNORECASE),
    re.compile(r"/rpc/", re.IGNORECASE),
    re.compile(r"/gql\b", re.IGNORECASE),
    re.compile(r"/query\b", re.IGNORECASE),
    re.compile(r"\.json$", re.IGNORECASE),
    re.compile(r"\.xml$", re.IGNORECASE),
]

# Static asset extensions — skip crawling, not candidates
_SKIP_EXTENSIONS = {
    ".css", ".js", ".jsx", ".ts", ".tsx",
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp", ".avif",
    ".woff", ".woff2", ".ttf", ".eot",
    ".pdf", ".zip", ".tar", ".gz", ".rar",
    ".mp4", ".mp3", ".webm", ".wav", ".ogg",
    ".map",
}

# Max response body to read (5 MB)
_MAX_RESPONSE_BYTES = 5 * 1024 * 1024

# HTML link / resource extraction
_HREF_RE = re.compile(r'href=["\']([^"\'>\s]+)["\']', re.IGNORECASE)
_SRC_RE = re.compile(r'src=["\']([^"\'>\s]+)["\']', re.IGNORECASE)
_ACTION_RE = re.compile(r'action=["\']([^"\'>\s]+)["\']', re.IGNORECASE)

# Sitemap XML helpers
_SITEMAP_LOC_RE = re.compile(r"<loc>\s*(https?://[^<\s]+)\s*</loc>", re.IGNORECASE)
_SITEMAP_INDEX_RE = re.compile(r"<sitemap>\s*<loc>\s*(https?://[^<\s]+)\s*</loc>", re.IGNORECASE)

# robots.txt Sitemap directive
_ROBOTS_SITEMAP_RE = re.compile(r"^Sitemap:\s*(https?://\S+)", re.IGNORECASE | re.MULTILINE)


@dataclass
class CrawledURL:
    """A single URL discovered during crawling with its classification."""
    url: str
    path: str
    resource_type: str  # "api" | "page" | "json" | "form"


@dataclass
class CrawlResult:
    """Result from website crawling."""
    pages_visited: int = 0
    # Classified URL lists
    api_paths: list[str] = field(default_factory=list)   # API pattern paths
    page_paths: list[str] = field(default_factory=list)  # HTML pages (sub-pages, listings, etc.)
    json_paths: list[str] = field(default_factory=list)  # JSON responses
    form_paths: list[str] = field(default_factory=list)  # Form action URLs
    all_urls: list[CrawledURL] = field(default_factory=list)  # Full typed collection
    all_paths: list[str] = field(default_factory=list)   # Every path (backward compat)
    js_urls: list[str] = field(default_factory=list)     # JS files for analysis
    error: str | None = None


def _canonicalize(url: str, base_netloc: str) -> str | None:
    """
    Normalize a URL, drop fragment, enforce same domain.
    Returns canonical URL string or None if it should be skipped.
    """
    try:
        parsed = urlparse(url)
        if parsed.scheme and parsed.scheme not in ("http", "https", ""):
            return None
        if not parsed.netloc and not parsed.path:
            return None
        path_lower = parsed.path.lower()
        for ext in _SKIP_EXTENSIONS:
            if path_lower.endswith(ext):
                return None
        if parsed.netloc and parsed.netloc != base_netloc:
            return None
        canonical = urlunparse((
            parsed.scheme, parsed.netloc, parsed.path,
            parsed.params, parsed.query, ""
        ))
        return canonical or None
    except Exception:
        return None


def _classify_path(path: str, content_type: str) -> str:
    """Classify a discovered URL by its path pattern and HTTP content-type."""
    ct = content_type.lower()
    if "json" in ct:
        return "json"
    if any(p.search(path) for p in _API_PATH_PATTERNS):
        return "api"
    return "page"


def _extract_links(
    html: str, base_url: str, base_netloc: str
) -> tuple[list[str], list[str], list[str]]:
    """
    Extract internal navigation links, form actions, and JS file URLs from HTML.

    Returns:
        (nav_links, form_actions, js_urls)
    """
    nav_links: list[str] = []
    form_actions: list[str] = []
    js_urls: list[str] = []

    for match in _HREF_RE.finditer(html):
        href = match.group(1).strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:", "data:")):
            continue
        absolute = urljoin(base_url, href)
        canonical = _canonicalize(absolute, base_netloc)
        if canonical:
            nav_links.append(canonical)

    for match in _ACTION_RE.finditer(html):
        action = match.group(1).strip()
        if not action or action.startswith(("#", "javascript:")):
            continue
        absolute = urljoin(base_url, action)
        canonical = _canonicalize(absolute, base_netloc)
        if canonical:
            form_actions.append(canonical)

    for match in _SRC_RE.finditer(html):
        src = match.group(1).strip()
        if src.endswith(".js") or ".js?" in src or "/js/" in src:
            absolute = urljoin(base_url, src)
            try:
                validate_url_for_outbound(absolute, context="js_asset_discovery")
                js_urls.append(absolute)
            except (SSRFBlockedError, ValueError):
                pass

    return nav_links, form_actions, js_urls


async def _probe_robots_and_sitemap(
    base_root: str,
    base_netloc: str,
    client: httpx.AsyncClient,
) -> list[str]:
    """
    Probe robots.txt for Sitemap directives, then parse each sitemap.
    Returns a list of same-domain seed URLs discovered.
    """
    seeds: list[str] = []
    sitemap_candidates: list[str] = []

    # Step 1: robots.txt
    try:
        robots_url = f"{base_root}/robots.txt"
        validate_url_for_outbound(robots_url, context="robots_probe")
        resp = await client.get(robots_url)
        if resp.status_code == 200 and len(resp.content) < 512 * 1024:
            for m in _ROBOTS_SITEMAP_RE.finditer(resp.text):
                sitemap_candidates.append(m.group(1).strip())
    except Exception:
        pass

    # Step 2: default sitemap paths if robots found none
    if not sitemap_candidates:
        for path in ("/sitemap.xml", "/sitemap_index.xml", "/sitemap/sitemap.xml"):
            sitemap_candidates.append(f"{base_root}{path}")

    # Step 3: parse sitemaps (cap at 5)
    for sitemap_url in sitemap_candidates[:5]:
        try:
            validate_url_for_outbound(sitemap_url, context="sitemap_probe")
            resp = await client.get(sitemap_url)
            if resp.status_code != 200:
                continue
            ct = resp.headers.get("content-type", "")
            if "xml" not in ct and "text" not in ct:
                continue
            text = resp.text

            # Handle sitemap index — one level deep
            for m in _SITEMAP_INDEX_RE.finditer(text):
                child_url = m.group(1).strip()
                try:
                    validate_url_for_outbound(child_url, context="sitemap_child")
                    child_resp = await client.get(child_url)
                    if child_resp.status_code == 200:
                        text += child_resp.text
                except Exception:
                    pass

            for m in _SITEMAP_LOC_RE.finditer(text):
                loc = m.group(1).strip()
                canonical = _canonicalize(loc, base_netloc)
                if canonical:
                    seeds.append(canonical)

            if seeds:
                logger.debug("sitemap_seeds_found", count=len(seeds), sitemap=sitemap_url)
                break  # first working sitemap is enough
        except Exception:
            continue

    return seeds


async def crawl_website(
    base_url: str,
    max_depth: int = 3,
    max_pages: int = 100,
    progress_callback: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
) -> CrawlResult:
    """
    BFS crawl of the target website, concurrent per level.

    Discovers ALL reachable same-domain URLs and classifies them
    (api / page / json / form) — not just paths that look like API endpoints.

    Seeds from:
    - The start URL provided by the user
    - robots.txt Sitemap directives
    - sitemap.xml / sitemap_index.xml

    Args:
        base_url:  Starting URL (user-provided project URL).
        max_depth: Maximum BFS depth (default 3).
        max_pages: Maximum pages to visit (default 100).
        progress_callback: Optional async callback for live progress updates.

    Returns:
        CrawlResult with all discovered URLs classified by type.
    """
    parsed_base = urlparse(base_url)
    base_netloc = parsed_base.netloc
    base_root = f"{parsed_base.scheme}://{base_netloc}"

    visited: set[str] = set()
    api_paths: set[str] = set()
    page_paths: set[str] = set()
    json_paths: set[str] = set()
    form_paths: set[str] = set()
    all_paths: set[str] = set()
    all_urls: list[CrawledURL] = []
    js_urls: set[str] = set()

    semaphore = asyncio.Semaphore(10)

    async with httpx.AsyncClient(
        timeout=8.0,
        follow_redirects=True,
        max_redirects=5,
        headers={
            "User-Agent": "APIMonitor-Discovery/1.0 (web-crawler; endpoint-discovery)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
        },
        limits=httpx.Limits(max_connections=15),
    ) as client:

        # ── Phase 1: Seed from robots.txt / sitemap ───────────────────────────
        sitemap_seeds = await _probe_robots_and_sitemap(base_root, base_netloc, client)

        # ── Phase 2: BFS ───────────────────────────────────────────────────────
        # Combine start URL with sitemap seeds — sitemap may reveal pages not linked from homepage
        start_urls = [base_url] + [s for s in sitemap_seeds if s != base_url]
        current_level: list[tuple[str, int]] = [(u, 0) for u in start_urls[:max_pages]]

        async def fetch_page(url: str, depth: int) -> tuple[list[str], list[str]]:
            """
            Fetch one page and record it in the appropriate classified bucket.
            Returns (outbound_links, js_urls_found).
            """
            try:
                validate_url_for_outbound(url, context="crawler")
            except (SSRFBlockedError, ValueError):
                return [], []

            try:
                async with semaphore:
                    response = await client.get(url)

                if response.status_code not in range(200, 400):
                    return [], []

                content_type = response.headers.get("content-type", "")
                is_html = "html" in content_type
                is_json = "json" in content_type

                if not is_html and not is_json:
                    return [], []

                path = urlparse(url).path or "/"
                rtype = _classify_path(path, content_type)
                all_paths.add(path)

                # Record into appropriate bucket
                if rtype == "json" or is_json:
                    json_paths.add(path)
                    api_paths.add(path)   # JSON responses are also API candidates
                    all_urls.append(CrawledURL(url=url, path=path, resource_type="json"))
                elif rtype == "api":
                    api_paths.add(path)
                    all_urls.append(CrawledURL(url=url, path=path, resource_type="api"))
                else:
                    page_paths.add(path)
                    all_urls.append(CrawledURL(url=url, path=path, resource_type="page"))

                # Extract links from HTML only, and only if within depth
                if is_html and depth < max_depth and len(response.content) <= _MAX_RESPONSE_BYTES:
                    links, actions, page_js = _extract_links(response.text, url, base_netloc)
                    # Record form actions
                    for fa in actions:
                        fpath = urlparse(fa).path
                        form_paths.add(fpath)
                        all_paths.add(fpath)
                    js_urls.update(page_js)
                    return links + actions, list(page_js)

            except Exception as exc:
                logger.debug("crawler_page_error", url=url, error=str(exc))

            return [], []

        while current_level and len(visited) < max_pages:
            remaining = max_pages - len(visited)
            to_process: list[tuple[str, int]] = []

            for url, depth in current_level:
                if url not in visited:
                    visited.add(url)
                    to_process.append((url, depth))
                    if len(to_process) >= remaining:
                        break

            if not to_process:
                break

            if progress_callback:
                try:
                    await progress_callback({
                        "pages_visited": len(visited),
                        "max_pages": max_pages,
                        "api_paths": len(api_paths),
                        "page_paths": len(page_paths),
                        "current_url": to_process[0][0],
                        "queue_size": len(current_level),
                    })
                except Exception:
                    pass

            tasks = [fetch_page(url, depth) for url, depth in to_process]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            next_level: list[tuple[str, int]] = []
            for i, res in enumerate(results):
                if isinstance(res, tuple):
                    links, _ = res
                    depth = to_process[i][1]
                    for link in links:
                        if link not in visited:
                            next_level.append((link, depth + 1))

            current_level = next_level

    return CrawlResult(
        pages_visited=len(visited),
        api_paths=list(api_paths),
        page_paths=list(page_paths),
        json_paths=list(json_paths),
        form_paths=list(form_paths),
        all_urls=all_urls,
        all_paths=list(all_paths),
        js_urls=list(js_urls),
    )

