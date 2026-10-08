"""
app/discovery/github.py
========================
GitHub Repository Discovery Provider.

Analyzes GitHub repository source code to discover API endpoints without
crawling the deployed application.

Workflow:
1. Parse owner/repo from the GitHub URL
2. Validate repository is publicly accessible via GitHub API
3. Fetch the file tree (no authentication required for public repos)
4. Filter to relevant source files (limited by size and extension)
5. Fetch and analyze each file for:
   - Backend route definitions (FastAPI, Flask, Django, Express, Next.js)
   - OpenAPI/Swagger spec files
   - Frontend API calls (fetch/axios patterns)
6. Deduplicate and score candidates
7. Return results

Security:
- Never executes discovered code
- Treats all file content as untrusted text
- Respects rate limits (60 req/hour unauthenticated)
- Limits: max 200 files, 512KB per file, timeout 60s
- Does NOT clone the repository

Note:
- GitHub URL ≠ Deployment URL
- Discovered routes are NOT verified against a live server unless
  a deployment_url is separately provided
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field
from urllib.parse import urlparse

import httpx
import structlog

logger = structlog.get_logger(__name__)

# Maximum files to analyze per repo
_MAX_FILES = 200

# Maximum file size to fetch (512 KB)
_MAX_FILE_SIZE = 512 * 1024

# Request timeout
_TIMEOUT = 15.0

# File extensions to analyze
_BACKEND_EXTENSIONS = {".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".rb", ".php"}
_SPEC_EXTENSIONS = {".json", ".yaml", ".yml"}
_SPEC_NAMES = {"openapi.json", "openapi.yaml", "openapi.yml", "swagger.json", "swagger.yaml", "swagger.yml"}

# GitHub API base
_GITHUB_API_BASE = "https://api.github.com"

# ─── Route pattern regexes ───────────────────────────────────────────────────

# FastAPI: @app.get("/path") or @router.post("/path")
_FASTAPI_RE = re.compile(
    r'@(?:app|router|api_router)\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*["\']([^"\']+)["\']',
    re.IGNORECASE,
)

# Flask: @app.route("/path") or @blueprint.route("/path", methods=["GET"])
_FLASK_ROUTE_RE = re.compile(
    r'@(?:\w+)\.route\s*\(\s*["\']([^"\']+)["\'](?:[^)]*methods\s*=\s*\[([^\]]*)\])?',
    re.IGNORECASE,
)

# Django: path("api/users/", ...) or re_path(...)
_DJANGO_PATH_RE = re.compile(
    r'(?:re_)?path\s*\(\s*[r]?["\']([^"\']+)["\']',
    re.IGNORECASE,
)

# Express: app.get("/path", ...) or router.post("/path", ...)
_EXPRESS_RE = re.compile(
    r'(?:app|router|server)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*["\']([^"\']+)["\']',
    re.IGNORECASE,
)

# Next.js API route files (app/api/*/route.ts or pages/api/*.ts)
_NEXTJS_API_DIR_RE = re.compile(r"(?:pages/api|app/api)/(.+?)(?:/route\.[jt]sx?)?$")

# Frontend API calls: fetch("/api/...") or axios.get("/api/...")
_FETCH_RE = re.compile(
    r'fetch\s*\(\s*["\']([^"\']+)["\']',
    re.IGNORECASE,
)
_AXIOS_RE = re.compile(
    r'axios\s*\.\s*(get|post|put|patch|delete)\s*\(\s*["\']([^"\']+)["\']',
    re.IGNORECASE,
)

# URL path sanity check — must look like a valid path
_VALID_PATH_RE = re.compile(r'^(/[\w\-./{}:*<>?%&]+|/?)$')

# Paths to ignore (static assets, auth pages, etc.)
_IGNORE_PATH_PREFIXES = (
    "/static/", "/assets/", "/public/", "/images/", "/fonts/",
    "/favicon", "/robots.txt", "/sitemap",
)
_IGNORE_EXTENSIONS = (".css", ".js", ".png", ".jpg", ".svg", ".ico", ".woff")


@dataclass
class GitHubEndpoint:
    """A single endpoint discovered from GitHub source code."""
    method: str
    path: str
    confidence: str  # HIGH | MEDIUM | LOW
    source_file: str = ""
    operation_id: str | None = None
    summary: str | None = None
    tags: list[str] = field(default_factory=list)


@dataclass
class GitHubDiscoveryResult:
    """Result from GitHub repository discovery."""
    owner: str = ""
    repo: str = ""
    files_analyzed: int = 0
    endpoints: list[GitHubEndpoint] = field(default_factory=list)
    error: str | None = None


def _parse_github_url(url: str) -> tuple[str, str] | None:
    """Parse owner and repo from a GitHub URL. Returns (owner, repo) or None."""
    url = url.rstrip("/")
    parsed = urlparse(url)
    if parsed.netloc.lower() not in ("github.com", "www.github.com"):
        return None
    parts = parsed.path.strip("/").split("/")
    if len(parts) < 2:
        return None
    owner, repo = parts[0], parts[1]
    # Remove .git suffix if present
    repo = repo.removesuffix(".git")
    if not owner or not repo:
        return None
    return owner, repo


def _clean_path(path: str) -> str | None:
    """Normalize and validate a discovered path. Returns None if invalid."""
    # Strip query strings and fragments
    path = path.split("?")[0].split("#")[0].strip()

    # Must start with /
    if not path.startswith("/"):
        path = "/" + path

    # Remove trailing slash (except root)
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")

    # Check it's a valid path
    if not _VALID_PATH_RE.match(path):
        return None

    # Skip static assets and ignored prefixes
    for prefix in _IGNORE_PATH_PREFIXES:
        if path.startswith(prefix):
            return None
    for ext in _IGNORE_EXTENSIONS:
        if path.endswith(ext):
            return None

    # Skip paths that are too long or clearly templates
    if len(path) > 500:
        return None

    return path


def _extract_fastapi_routes(content: str, filename: str) -> list[GitHubEndpoint]:
    """Extract FastAPI route definitions."""
    endpoints = []
    for match in _FASTAPI_RE.finditer(content):
        method = match.group(1).upper()
        path = _clean_path(match.group(2))
        if path:
            endpoints.append(GitHubEndpoint(
                method=method,
                path=path,
                confidence="HIGH",
                source_file=filename,
                tags=["FastAPI"],
            ))
    return endpoints


def _extract_flask_routes(content: str, filename: str) -> list[GitHubEndpoint]:
    """Extract Flask route definitions."""
    endpoints = []
    for match in _FLASK_ROUTE_RE.finditer(content):
        raw_path = match.group(1)
        methods_str = match.group(2) or "GET"
        path = _clean_path(raw_path)
        if not path:
            continue
        # Parse methods
        method_matches = re.findall(r'"([A-Z]+)"|\'([A-Z]+)\'', methods_str.upper())
        methods = [m[0] or m[1] for m in method_matches] or ["GET"]
        for m in methods:
            if m in ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"):
                endpoints.append(GitHubEndpoint(
                    method=m,
                    path=path,
                    confidence="HIGH",
                    source_file=filename,
                    tags=["Flask"],
                ))
    return endpoints


def _extract_django_routes(content: str, filename: str) -> list[GitHubEndpoint]:
    """Extract Django URL patterns."""
    endpoints = []
    for match in _DJANGO_PATH_RE.finditer(content):
        raw_path = match.group(1)
        # Django paths use regex or simple strings — normalize
        path = raw_path.replace("^", "").replace("$", "")
        # Convert regex groups to path parameters
        path = re.sub(r"\(\?P<(\w+)>[^)]+\)", r"{\1}", path)
        path = re.sub(r"\([^)]+\)", "{param}", path)
        path = _clean_path("/" + path.lstrip("/"))
        if path and len(path) > 1:
            endpoints.append(GitHubEndpoint(
                method="GET",
                path=path,
                confidence="MEDIUM",
                source_file=filename,
                tags=["Django"],
            ))
    return endpoints


def _extract_express_routes(content: str, filename: str) -> list[GitHubEndpoint]:
    """Extract Express.js route definitions."""
    endpoints = []
    for match in _EXPRESS_RE.finditer(content):
        method = match.group(1).upper()
        path = _clean_path(match.group(2))
        if path:
            endpoints.append(GitHubEndpoint(
                method=method,
                path=path,
                confidence="HIGH",
                source_file=filename,
                tags=["Express"],
            ))
    return endpoints


def _extract_frontend_calls(content: str, filename: str) -> list[GitHubEndpoint]:
    """Extract frontend API calls (fetch, axios)."""
    endpoints = []

    for match in _FETCH_RE.finditer(content):
        path = _clean_path(match.group(1))
        if path and path.startswith("/api"):
            endpoints.append(GitHubEndpoint(
                method="GET",
                path=path,
                confidence="MEDIUM",
                source_file=filename,
                tags=["fetch"],
            ))

    for match in _AXIOS_RE.finditer(content):
        method = match.group(1).upper()
        path = _clean_path(match.group(2))
        if path and (path.startswith("/api") or path.startswith("/v")):
            endpoints.append(GitHubEndpoint(
                method=method,
                path=path,
                confidence="MEDIUM",
                source_file=filename,
                tags=["axios"],
            ))

    return endpoints


def _extract_nextjs_route(filepath: str) -> GitHubEndpoint | None:
    """Convert a Next.js API route file path to an endpoint."""
    match = _NEXTJS_API_DIR_RE.search(filepath.replace("\\", "/"))
    if not match:
        return None

    route_suffix = match.group(1)
    # Remove /route suffix from app router pattern
    route_suffix = re.sub(r"/route$", "", route_suffix)
    # Convert [param] to {param}
    path = re.sub(r"\[(\w+)\]", r"{\1}", route_suffix)
    path = _clean_path("/" + path.lstrip("/"))

    if path:
        return GitHubEndpoint(
            method="GET",
            path=path,
            confidence="HIGH",
            source_file=filepath,
            tags=["Next.js"],
        )
    return None


def _extract_openapi_from_spec(content: str, filename: str) -> list[GitHubEndpoint]:
    """Parse OpenAPI/Swagger spec file and extract endpoints."""
    endpoints = []
    try:
        import json as _json
        import yaml as _yaml

        spec = None
        if filename.endswith(".json"):
            try:
                spec = _json.loads(content)
            except Exception:
                pass
        if spec is None:
            try:
                spec = _yaml.safe_load(content)
            except Exception:
                pass

        if not isinstance(spec, dict):
            return endpoints

        paths = spec.get("paths", {})
        if not isinstance(paths, dict):
            return endpoints

        valid_methods = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
        for path, path_item in paths.items():
            if not isinstance(path_item, dict):
                continue
            clean = _clean_path(path)
            if not clean:
                continue
            for method, operation in path_item.items():
                m = method.upper()
                if m not in valid_methods:
                    continue
                if not isinstance(operation, dict):
                    continue
                tags = operation.get("tags", [])
                if not isinstance(tags, list):
                    tags = []
                endpoints.append(GitHubEndpoint(
                    method=m,
                    path=clean,
                    confidence="HIGH",
                    source_file=filename,
                    operation_id=operation.get("operationId"),
                    summary=operation.get("summary"),
                    tags=tags + ["OpenAPI"],
                ))
    except Exception as exc:
        logger.debug("openapi_spec_parse_error", filename=filename, error=str(exc))

    return endpoints


def _analyze_file(filepath: str, content: str) -> list[GitHubEndpoint]:
    """
    Analyze a single source file for API endpoint patterns.
    Routes based on file extension and detected framework.
    """
    endpoints = []
    lower_path = filepath.lower()
    filename = filepath.split("/")[-1].lower()

    # OpenAPI/Swagger spec files
    if filename in _SPEC_NAMES:
        return _extract_openapi_from_spec(content, filepath)

    # Next.js API routes (file path IS the route)
    if "pages/api/" in lower_path or "/app/api/" in lower_path:
        ep = _extract_nextjs_route(filepath)
        if ep:
            endpoints.append(ep)
        # Also look for fetch/axios inside the file
        endpoints.extend(_extract_frontend_calls(content, filepath))
        return endpoints

    # Python files — detect FastAPI or Flask
    if lower_path.endswith(".py"):
        # FastAPI patterns (@app.get, @router.get, etc.)
        fa_eps = _extract_fastapi_routes(content, filepath)
        if fa_eps:
            endpoints.extend(fa_eps)
        # Flask patterns (@app.route, @blueprint.route)
        fl_eps = _extract_flask_routes(content, filepath)
        if fl_eps:
            endpoints.extend(fl_eps)
        # Django url patterns (urls.py files)
        if "urls.py" in lower_path or "url" in lower_path:
            endpoints.extend(_extract_django_routes(content, filepath))

    # JavaScript/TypeScript — Express or frontend
    elif lower_path.endswith((".js", ".ts", ".jsx", ".tsx")):
        # Express route patterns
        exp_eps = _extract_express_routes(content, filepath)
        if exp_eps:
            endpoints.extend(exp_eps)
        # Frontend API calls
        endpoints.extend(_extract_frontend_calls(content, filepath))

    return endpoints


async def discover_github_repo(
    repo_url: str,
    deployment_url: str | None = None,
) -> GitHubDiscoveryResult:
    """
    Analyze a GitHub repository for API endpoint definitions.

    Args:
        repo_url:       Full GitHub URL (https://github.com/owner/repo)
        deployment_url: Optional live deployment URL for verification context

    Returns:
        GitHubDiscoveryResult with discovered endpoints
    """
    parsed = _parse_github_url(repo_url)
    if parsed is None:
        return GitHubDiscoveryResult(error=f"Invalid GitHub URL: {repo_url}")

    owner, repo = parsed
    result = GitHubDiscoveryResult(owner=owner, repo=repo)

    logger.info("github_discovery_started", owner=owner, repo=repo)

    headers = {
        "User-Agent": "APIMonitor-Discovery/1.0",
        "Accept": "application/vnd.github.v3+json",
    }

    async with httpx.AsyncClient(
        timeout=_TIMEOUT,
        follow_redirects=True,
        headers=headers,
        limits=httpx.Limits(max_connections=5),
    ) as client:
        # ── Step 1: Check repository exists and is public ─────────────────────
        try:
            repo_resp = await client.get(f"{_GITHUB_API_BASE}/repos/{owner}/{repo}")
            if repo_resp.status_code == 404:
                result.error = f"Repository {owner}/{repo} not found or is private"
                return result
            if repo_resp.status_code == 403:
                result.error = "GitHub API rate limit exceeded. Try again later."
                return result
            if repo_resp.status_code != 200:
                result.error = f"GitHub API error: {repo_resp.status_code}"
                return result

            repo_data = repo_resp.json()
            if repo_data.get("private", False):
                result.error = f"Repository {owner}/{repo} is private"
                return result

            # Get default branch
            default_branch = repo_data.get("default_branch", "main")
        except Exception as exc:
            result.error = f"Failed to access repository: {str(exc)[:200]}"
            return result

        # ── Step 2: Fetch file tree ───────────────────────────────────────────
        try:
            tree_resp = await client.get(
                f"{_GITHUB_API_BASE}/repos/{owner}/{repo}/git/trees/{default_branch}",
                params={"recursive": "1"},
            )
            if tree_resp.status_code == 404:
                result.error = f"Could not fetch file tree for branch '{default_branch}'"
                return result
            if tree_resp.status_code == 403:
                result.error = "GitHub API rate limit exceeded. Try again later."
                return result
            if tree_resp.status_code != 200:
                result.error = f"File tree API error: {tree_resp.status_code}"
                return result

            tree_data = tree_resp.json()
        except Exception as exc:
            result.error = f"Failed to fetch file tree: {str(exc)[:200]}"
            return result

        # ── Step 3: Filter relevant files ────────────────────────────────────
        tree_items = tree_data.get("tree", [])

        def _should_analyze(item: dict) -> bool:
            if item.get("type") != "blob":
                return False
            path = item.get("path", "")
            size = item.get("size", 0)

            # Skip large files
            if size > _MAX_FILE_SIZE:
                return False

            lower = path.lower()
            name = lower.split("/")[-1]

            # Always include OpenAPI spec files
            if name in _SPEC_NAMES:
                return True

            # Include Next.js API routes
            if "pages/api/" in lower or "/app/api/" in lower:
                ext = "." + name.rsplit(".", 1)[-1] if "." in name else ""
                return ext in _BACKEND_EXTENSIONS

            # Include backend route files
            ext = "." + name.rsplit(".", 1)[-1] if "." in name else ""
            if ext not in _BACKEND_EXTENSIONS:
                return False

            # Skip vendor/test/build directories
            skip_dirs = (
                "node_modules/", "vendor/", ".git/", "dist/", "build/",
                "__pycache__/", ".venv/", "venv/", "env/", "test/",
                "tests/", "spec/", "__tests__/", "coverage/",
            )
            return not any(lower.startswith(d) for d in skip_dirs)

        relevant_files = [item for item in tree_items if _should_analyze(item)][:_MAX_FILES]

        logger.info(
            "github_files_to_analyze",
            owner=owner, repo=repo,
            total_files=len(tree_items),
            relevant_files=len(relevant_files),
        )

        # ── Step 4: Fetch and analyze each file ──────────────────────────────
        all_endpoints: list[GitHubEndpoint] = []
        files_analyzed = 0

        semaphore = asyncio.Semaphore(5)  # Max 5 concurrent file fetches

        async def _fetch_and_analyze(item: dict) -> list[GitHubEndpoint]:
            nonlocal files_analyzed
            filepath = item["path"]

            async with semaphore:
                try:
                    content_resp = await client.get(
                        f"https://raw.githubusercontent.com/{owner}/{repo}/{default_branch}/{filepath}",
                        headers={"User-Agent": "APIMonitor-Discovery/1.0"},
                    )
                    if content_resp.status_code != 200:
                        return []

                    content = content_resp.text
                    files_analyzed += 1
                    return _analyze_file(filepath, content)
                except Exception as exc:
                    logger.debug("github_file_fetch_error", filepath=filepath, error=str(exc))
                    return []

        tasks = [_fetch_and_analyze(item) for item in relevant_files]
        file_results = await asyncio.gather(*tasks, return_exceptions=True)

        for file_result in file_results:
            if isinstance(file_result, list):
                all_endpoints.extend(file_result)

        result.files_analyzed = files_analyzed

        # ── Step 5: Deduplicate endpoints ────────────────────────────────────
        seen: dict[tuple[str, str], GitHubEndpoint] = {}
        confidence_rank = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}

        for ep in all_endpoints:
            key = (ep.method.upper(), ep.path)
            if key not in seen:
                seen[key] = ep
            else:
                existing = seen[key]
                if confidence_rank.get(ep.confidence, 0) > confidence_rank.get(existing.confidence, 0):
                    seen[key] = ep

        result.endpoints = list(seen.values())

        logger.info(
            "github_discovery_completed",
            owner=owner, repo=repo,
            files_analyzed=files_analyzed,
            endpoints_found=len(result.endpoints),
        )

    return result
