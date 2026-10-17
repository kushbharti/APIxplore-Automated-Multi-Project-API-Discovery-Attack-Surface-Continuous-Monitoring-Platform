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

import asyncio
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
    # Top standard locations
    "/openapi.json",
    "/swagger.json",
    "/v2/swagger.json",
    "/v3/swagger.json",
    "/v1/swagger.json",
    "/v3/api-docs",
    "/v3/api-docs/swagger-config",
    "/v2/api-docs",
    "/api-docs",
    "/api-docs.json",
    "/api/openapi.json",
    "/api/swagger.json",
    "/api/v1/openapi.json",
    "/api/v2/openapi.json",
    "/api/v3/openapi.json",
    "/api/v1/swagger.json",
    "/api/v2/swagger.json",
    "/api/v3/swagger.json",
    "/openapi.yaml",
    "/openapi.yml",
    "/swagger.yaml",
    "/swagger.yml",
    "/swagger/v1/swagger.json",
    "/swagger/v2/swagger.json",
    "/docs/openapi.json",
    "/docs/swagger.json",
    "/swagger/openapi.json",
    "/swagger/swagger.json",
    "/documentation/json",
    "/documentation/yaml",
    "/.well-known/openapi.json",
    "/.well-known/openapi.yaml",
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


async def discover_openapi(
    base_url: str,
    headers: dict[str, str] | None = None,
) -> OpenAPIResult:
    """
    Probe the target domain for OpenAPI/Swagger specs using fast concurrent probing.

    Args:
        base_url: The root URL or project URL of the target.
        headers:  Optional auth headers for login-protected targets.

    Returns:
        OpenAPIResult with found=True and endpoints list if spec found,
        or found=False otherwise.
    """
    parsed = urlparse(base_url)
    root = f"{parsed.scheme}://{parsed.netloc}"

    client_headers = {
        "User-Agent": "APIMonitor-Discovery/1.0 (endpoint-discovery-bot)",
        "Accept": "application/json, application/yaml, text/yaml, */*;q=0.8",
    }
    if headers:
        client_headers.update(headers)

    async with httpx.AsyncClient(
        timeout=8.0,
        follow_redirects=True,
        max_redirects=3,
        headers=client_headers,
        limits=httpx.Limits(max_connections=15),
    ) as client:
        # 1. If base_url itself looks like a spec URL, try it directly first
        path_lower = parsed.path.lower()
        if any(path_lower.endswith(ext) for ext in (".json", ".yaml", ".yml")) or "swagger" in path_lower or "openapi" in path_lower:
            direct_res = await _try_fetch_spec(client, base_url, root)
            if direct_res is not None:
                return direct_res

        # 2. Build candidate spec URLs to check
        candidate_urls: list[str] = []
        # If target has a path (e.g. /api or /v1), probe relative to that path first
        if parsed.path.strip("/") and not any(parsed.path.endswith(ext) for ext in (".html", ".htm", ".json")):
            target_prefix = base_url.rstrip("/")
            for path in _OPENAPI_PATHS[:15]:
                candidate_urls.append(f"{target_prefix}{path}")

        # Standard paths relative to root
        for path in _OPENAPI_PATHS:
            candidate_urls.append(urljoin(root, path))

        # Deduplicate preserving order
        unique_candidates = list(dict.fromkeys(candidate_urls))

        # 3. Concurrent spec probe with early cancellation
        semaphore = asyncio.Semaphore(8)

        async def _probe(url: str) -> OpenAPIResult | None:
            try:
                async with semaphore:
                    return await _try_fetch_spec(client, url, root)
            except asyncio.CancelledError:
                return None
            except Exception:
                return None

        probe_tasks = [asyncio.create_task(_probe(u)) for u in unique_candidates]

        for fut in asyncio.as_completed(probe_tasks):
            try:
                res = await fut
                if res is not None and res.found:
                    # Cancel other probe tasks immediately
                    for t in probe_tasks:
                        if not t.done():
                            t.cancel()
                    return res
            except asyncio.CancelledError:
                continue
            except Exception as exc:
                logger.debug("openapi_probe_fut_error", error=str(exc))
                continue

        # 4. If no direct spec found, scan UI documentation pages (Swagger UI / ReDoc)
        # for embedded spec URLs or swagger-initializer.js scripts
        html_result = await _scan_html_for_spec_url(client, base_url, root)
        if html_result is not None:
            return html_result

    return OpenAPIResult(found=False)


async def _scan_html_for_spec_url(
    client: httpx.AsyncClient, page_url: str, base_url: str
) -> OpenAPIResult | None:
    """
    Fetch documentation pages and look for Swagger UI / ReDoc / initializer spec references.
    """
    import re as _re

    _INIT_SCRIPT_RE = _re.compile(r"""<script[^>]+src=["']([^"']*(?:swagger-initializer|swagger-ui-bundle)[^"']*)["']""", _re.IGNORECASE)
    _SPEC_URL_PATTERNS = [
        _re.compile(r"""defaultDefinitionUrl\s*=\s*['"]([^'"]+)['"]""", _re.IGNORECASE),
        _re.compile(r"""SwaggerUIBundle\s*\(\s*\{[^}]*?url\s*:\s*['"]([^'"]+)['"]""", _re.IGNORECASE | _re.DOTALL),
        _re.compile(r"""urls\s*:\s*\[\s*\{[^}]*?url\s*:\s*['"]([^'"]+)['"]""", _re.IGNORECASE | _re.DOTALL),
        _re.compile(r"""spec-url\s*=\s*['"]([^'"]+)['"]""", _re.IGNORECASE),
        _re.compile(r"""data-spec-url\s*=\s*['"]([^'"]+)['"]""", _re.IGNORECASE),
        _re.compile(r"""url\s*:\s*['"]([^'"]*(?:openapi|swagger|api-docs)[^'"]*)['"]""", _re.IGNORECASE),
    ]

    pages_to_scan = [
        page_url,
        urljoin(base_url, "/docs"),
        urljoin(base_url, "/redoc"),
        urljoin(base_url, "/swagger"),
        urljoin(base_url, "/swagger/"),
        urljoin(base_url, "/swagger-ui.html"),
        urljoin(base_url, "/swagger-ui/"),
        urljoin(base_url, "/swagger-ui/index.html"),
        urljoin(base_url, "/swagger/index.html"),
        urljoin(base_url, "/api/docs"),
        urljoin(base_url, "/api-docs"),
        urljoin(base_url, "/api/v1/docs"),
        urljoin(base_url, "/api/v2/docs"),
        urljoin(base_url, "/docs/api"),
    ]
    pages_to_scan = list(dict.fromkeys(pages_to_scan))

    parsed_root = urlparse(base_url)
    root_netloc = parsed_root.netloc

    for scan_url in pages_to_scan:
        try:
            validate_url_for_outbound(scan_url, context="openapi_html_scan")
            resp = await client.get(scan_url)
            if resp.status_code != 200:
                continue

            content_type = resp.headers.get("content-type", "").lower()
            text = resp.text

            # Check if this response is itself an OpenAPI JSON/YAML spec
            if "json" in content_type or "yaml" in content_type:
                spec_res = await _try_fetch_spec(client, scan_url, base_url)
                if spec_res is not None:
                    return spec_res

            if "html" not in content_type and "<html" not in text.lower():
                continue

            # A. Look for swagger-initializer.js or external config scripts
            for script_match in _INIT_SCRIPT_RE.finditer(text):
                raw_script_url = script_match.group(1).strip()
                abs_script_url = urljoin(scan_url, raw_script_url)
                try:
                    validate_url_for_outbound(abs_script_url, context="openapi_script_scan")
                    script_resp = await client.get(abs_script_url)
                    if script_resp.status_code == 200:
                        script_content = script_resp.text
                        for p in _SPEC_URL_PATTERNS:
                            m = p.search(script_content)
                            if m:
                                found_url = m.group(1).strip()
                                abs_spec = urljoin(abs_script_url, found_url)
                                result = await _try_fetch_spec(client, abs_spec, base_url)
                                if result is not None:
                                    logger.info("openapi_spec_found_via_initializer_script", url=abs_spec)
                                    return result
                except Exception:
                    pass

            # B. Look for inline spec URL definitions in HTML
            for pattern in _SPEC_URL_PATTERNS:
                m = pattern.search(text)
                if m:
                    raw_spec_url = m.group(1).strip()
                    absolute_spec_url = urljoin(scan_url, raw_spec_url)
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
    except (SSRFBlockedError, ValueError):
        return None

    try:
        response = await client.get(spec_url)
        if response.status_code < 200 or response.status_code >= 300:
            return None

        content_type = response.headers.get("content-type", "")
        content = response.text

        # Try JSON first (most specs are served as application/json)
        spec = None
        try:
            spec = json.loads(content)
        except json.JSONDecodeError:
            pass

        # Try YAML if JSON failed
        if spec is None:
            try:
                spec = yaml.safe_load(content)
                # yaml.safe_load can return a string for non-YAML content — reject that
                if not isinstance(spec, dict):
                    spec = None
            except Exception:
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

    parsed_base = urlparse(base_url)
    default_scheme = parsed_base.scheme or "https"
    default_netloc = parsed_base.netloc

    # Determine base URL from spec servers (OpenAPI 3.x)
    spec_base = base_url.rstrip("/")
    servers = spec.get("servers", [])
    if servers and isinstance(servers, list):
        first_server = servers[0]
        if isinstance(first_server, dict):
            server_url = first_server.get("url", "")
            # Substitute OpenAPI 3 server variables with defaults if present
            vars_dict = first_server.get("variables", {})
            if isinstance(vars_dict, dict):
                for vname, vinfo in vars_dict.items():
                    if isinstance(vinfo, dict) and "default" in vinfo:
                        server_url = server_url.replace(f"{{{vname}}}", str(vinfo["default"]))
            if server_url.startswith(("http://", "https://")):
                spec_base = server_url.rstrip("/")
            elif server_url and not server_url.startswith("{"):
                spec_base = urljoin(base_url.rstrip("/") + "/", server_url.lstrip("/")).rstrip("/")

    # Swagger 2.0 host and basePath
    if spec.get("swagger") or "basePath" in spec:
        schemes = spec.get("schemes") or [default_scheme]
        scheme = schemes[0] if schemes else default_scheme
        host = spec.get("host") or default_netloc
        base_path = spec.get("basePath", "").rstrip("/")
        spec_base = f"{scheme}://{host}{base_path}"

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
            clean_path = path if path.startswith("/") else f"/{path}"
            full_url = f"{spec_base.rstrip('/')}{clean_path}"

            # Extract metadata
            tags = operation.get("tags", [])
            if not isinstance(tags, list):
                tags = []

            ep = OpenAPIEndpoint(
                method=method_upper,
                path=clean_path,
                full_url=full_url,
                operation_id=operation.get("operationId"),
                summary=operation.get("summary") or operation.get("description"),
                tags=[str(t) for t in tags],
            )
            endpoints.append(ep)

    return endpoints
