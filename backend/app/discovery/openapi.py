"""
app/discovery/openapi.py
=========================
OpenAPI / Swagger discovery provider.

Checks common OpenAPI spec locations on the target domain.
If a spec is found, extracts all endpoints with HIGH confidence.

Common locations checked:
  /openapi.json, /openapi.yaml, /swagger.json, /swagger.yaml,
  /api-docs, /api/swagger.json, /v1/api-docs, /v2/api-docs,
  /v3/api-docs, /swagger/v1/swagger.json, /docs/swagger.json,
  /api/openapi.json, /api-docs.json

Design:
- Each location is checked independently.
- First found spec is used (stops checking after finding one).
- SSRF validation is performed before each request.
- Never raises — returns empty list on any error.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlparse

import httpx
import structlog
import yaml

from app.core.ssrf import validate_url_for_outbound
from app.core.exceptions import SSRFBlockedError

logger = structlog.get_logger(__name__)

# Common OpenAPI spec URL paths to probe
_OPENAPI_PATHS = [
    "/openapi.json",
    "/openapi.yaml",
    "/openapi.yml",
    "/swagger.json",
    "/swagger.yaml",
    "/swagger.yml",
    "/api-docs",
    "/api-docs.json",
    "/api/swagger.json",
    "/api/openapi.json",
    "/api/docs",
    "/v1/api-docs",
    "/v2/api-docs",
    "/v3/api-docs",
    "/swagger/v1/swagger.json",
    "/swagger/v2/swagger.json",
    "/docs/swagger.json",
    "/docs/openapi.json",
    "/api/v1/openapi.json",
    "/api/v2/openapi.json",
]

# Standard HTTP methods we extract from specs
_VALID_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}

# Safe monitoring methods only (we verify with HEAD/GET)
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@dataclass
class OpenAPIEndpoint:
    """A single endpoint extracted from an OpenAPI spec."""
    method: str
    path: str
    full_url: str
    operation_id: str | None = None
    summary: str | None = None
    tags: list[str] = field(default_factory=list)


@dataclass
class OpenAPIResult:
    """Result from OpenAPI discovery."""
    found: bool = False
    spec_url: str | None = None
    endpoints: list[OpenAPIEndpoint] = field(default_factory=list)
    error: str | None = None


async def discover_openapi(base_url: str) -> OpenAPIResult:
    """
    Probe the target domain for OpenAPI/Swagger specs.

    Args:
        base_url: The root URL of the target (e.g. https://api.example.com)

    Returns:
        OpenAPIResult with found=True and endpoints list if spec found,
        or found=False otherwise.
    """
    parsed = urlparse(base_url)
    root = f"{parsed.scheme}://{parsed.netloc}"

    async with httpx.AsyncClient(
        timeout=10.0,
        follow_redirects=True,
        max_redirects=3,
        headers={"User-Agent": "APIMonitor-Discovery/1.0 (endpoint-discovery-bot)"},
        limits=httpx.Limits(max_connections=5),
    ) as client:
        for path in _OPENAPI_PATHS:
            spec_url = urljoin(root, path)
            result = await _try_fetch_spec(client, spec_url, root)
            if result is not None:
                return result

        # If no spec found at known paths, scan the homepage and /docs page
        # for embedded spec URLs (e.g. Swagger UI injects the spec URL into HTML)
        result = await _scan_html_for_spec_url(client, root, root)
        if result is not None:
            return result

    return OpenAPIResult(found=False)


async def _scan_html_for_spec_url(
    client: httpx.AsyncClient, page_url: str, base_url: str
) -> OpenAPIResult | None:
    """
    Fetch a page and look for Swagger UI / ReDoc spec URL references embedded in HTML.

    Swagger UI commonly injects the spec URL as:
      SwaggerUIBundle({ url: "/openapi.json", ... })
      url: "/swagger.json"

    ReDoc uses:
      <redoc spec-url='/openapi.json'>
      data-spec-url="/openapi.json"
    """
    import re as _re

    _SPEC_URL_PATTERNS = [
        _re.compile(r"""SwaggerUIBundle\s*\(\s*\{[^}]{0,500}url\s*:\s*['"]([^'"]+)['"]""", _re.IGNORECASE | _re.DOTALL),
        _re.compile(r"""spec-url\s*=\s*['"]([^'"]+)['"]""", _re.IGNORECASE),
        _re.compile(r"""data-spec-url\s*=\s*['"]([^'"]+)['"]""", _re.IGNORECASE),
        _re.compile(r"""url\s*:\s*['"]([^'"]*(?:openapi|swagger)[^'"]*)['"]""", _re.IGNORECASE),
    ]

    pages_to_scan = [page_url, urljoin(page_url, "/docs"), urljoin(page_url, "/swagger")]
    parsed_root = urlparse(base_url)
    root_netloc = parsed_root.netloc

    for scan_url in pages_to_scan:
        try:
            validate_url_for_outbound(scan_url, context="openapi_html_scan")
            resp = await client.get(scan_url)
            if resp.status_code != 200:
                continue
            if "html" not in resp.headers.get("content-type", ""):
                continue
            html = resp.text
            for pattern in _SPEC_URL_PATTERNS:
                m = pattern.search(html)
                if m:
                    raw_spec_url = m.group(1).strip()
                    # Make absolute
                    absolute_spec_url = urljoin(scan_url, raw_spec_url)
                    # Must be same domain
                    if urlparse(absolute_spec_url).netloc != root_netloc:
                        continue
                    result = await _try_fetch_spec(client, absolute_spec_url, base_url)
                    if result is not None:
                        logger.info("openapi_spec_found_via_html_scan", url=absolute_spec_url, page=scan_url)
                        return result
        except Exception:
            continue

    return None


async def _try_fetch_spec(
    client: httpx.AsyncClient, spec_url: str, base_url: str
) -> OpenAPIResult | None:
    """
    Attempt to fetch and parse one spec URL.
    Returns OpenAPIResult if successful, None if not found/invalid.
    """
    try:
        validate_url_for_outbound(spec_url, context="openapi_discovery")
    except SSRFBlockedError:
        return None
    except ValueError:
        return None

    try:
        response = await client.get(spec_url)
        if response.status_code not in (200, 201):
            return None

        content_type = response.headers.get("content-type", "")
        content = response.text

        # Try JSON first
        spec = None
        if "json" in content_type or spec_url.endswith((".json",)):
            try:
                spec = json.loads(content)
            except json.JSONDecodeError:
                pass

        # Try YAML
        if spec is None and ("yaml" in content_type or "text/plain" in content_type
                             or spec_url.endswith((".yaml", ".yml", "-docs"))):
            try:
                spec = yaml.safe_load(content)
            except Exception:
                pass

        # Try JSON regardless of content type
        if spec is None:
            try:
                spec = json.loads(content)
            except json.JSONDecodeError:
                pass

        if spec is None or not isinstance(spec, dict):
            return None

        # Check it looks like an OpenAPI spec
        if not _is_openapi_spec(spec):
            return None

        logger.info("openapi_spec_found", url=spec_url)
        endpoints = _extract_endpoints(spec, base_url)
        return OpenAPIResult(found=True, spec_url=spec_url, endpoints=endpoints)

    except SSRFBlockedError:
        return None
    except httpx.TimeoutException:
        return None
    except httpx.ConnectError:
        return None
    except Exception as exc:
        logger.debug("openapi_probe_error", url=spec_url, error=str(exc))
        return None


def _is_openapi_spec(spec: dict) -> bool:
    """Heuristic check: does this look like an OpenAPI spec?"""
    # OpenAPI 3.x
    if "openapi" in spec and "paths" in spec:
        return True
    # Swagger 2.0
    if spec.get("swagger") and "paths" in spec:
        return True
    # Minimal check
    if "paths" in spec and isinstance(spec["paths"], dict):
        return True
    return False


def _extract_endpoints(spec: dict, base_url: str) -> list[OpenAPIEndpoint]:
    """Extract endpoints from OpenAPI/Swagger spec."""
    endpoints: list[OpenAPIEndpoint] = []
    paths = spec.get("paths", {})

    # Determine base URL from spec servers (OpenAPI 3.x)
    spec_base = base_url
    servers = spec.get("servers", [])
    if servers and isinstance(servers, list):
        first_server = servers[0]
        if isinstance(first_server, dict):
            server_url = first_server.get("url", "")
            if server_url.startswith("http"):
                spec_base = server_url.rstrip("/")

    # Swagger 2.0 base path
    if "basePath" in spec:
        parsed = urlparse(base_url)
        spec_base = f"{parsed.scheme}://{parsed.netloc}{spec.get('basePath', '')}"

    for path, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue

        for method, operation in path_item.items():
            method_upper = method.upper()
            if method_upper not in _VALID_METHODS:
                continue
            if not isinstance(operation, dict):
                continue

            # Build full URL
            full_url = f"{spec_base.rstrip('/')}/{path.lstrip('/')}"

            # Extract metadata
            tags = operation.get("tags", [])
            if not isinstance(tags, list):
                tags = []

            ep = OpenAPIEndpoint(
                method=method_upper,
                path=path,
                full_url=full_url,
                operation_id=operation.get("operationId"),
                summary=operation.get("summary"),
                tags=tags,
            )
            endpoints.append(ep)

    return endpoints
