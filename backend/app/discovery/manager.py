"""
app/discovery/manager.py
=========================
Discovery manager — orchestrates all providers and aggregates results.

Execution flow:
1. URL Classification (GitHub repo vs. website/API)
2. OpenAPI detection (check common spec paths) [website only]
3. Website crawl (BFS, bounded) [website only]
4. JavaScript analysis (from JS files found during crawl) [website only]
5. GitHub source code analysis [GitHub repos only]
6. Deduplication of all candidates
7. Verification of all unique candidates (websites only; GitHub = NOT_VERIFIED)

Each provider runs independently — one failure doesn't abort the others.
Results are stored directly in the discovery_runs + discovery_candidates tables.

Critical fix: Only API-pattern paths are added as candidates.
HTML pages (locale routes like /vi, /bg, /zh, /de) are NOT API candidates.
"""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from datetime import UTC, datetime
from urllib.parse import urljoin, urlparse

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ssrf import validate_url_for_outbound
from app.core.exceptions import SSRFBlockedError
from app.discovery.crawler import crawl_website
from app.discovery.javascript import analyze_javascript
from app.discovery.openapi import discover_openapi
from app.discovery.verifier import verify_batch
from app.models.discovery_candidate import (
    DiscoveryCandidate,
    DiscoveryConfidence,
    DiscoverySource,
    VerificationStatus,
)
from app.models.discovery_run import DiscoveryRun, DiscoveryStatus

logger = structlog.get_logger(__name__)

# Matches GitHub repository URL:   github.com/OWNER/REPO (exactly 2 segments)
_GITHUB_REPO_RE = re.compile(
    r"^https?://(?:www\.)?github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/?$",
    re.IGNORECASE,
)
# Matches GitHub profile URL:      github.com/USERNAME (exactly 1 segment)
_GITHUB_PROFILE_RE = re.compile(
    r"^https?://(?:www\.)?github\.com/([A-Za-z0-9_.-]+)/?(?:\?.*)?$",
    re.IGNORECASE,
)


def _classify_github_url(url: str) -> str | None:
    """
    Classify a GitHub URL.
    Returns:
        'repo'    — github.com/OWNER/REPO
        'profile' — github.com/USERNAME  (with optional ?tab=...)
        None      — not a GitHub URL
    """
    stripped = url.split("?")[0].rstrip("/")
    # Try repo first (more specific)
    if _GITHUB_REPO_RE.match(stripped):
        return "repo"
    # Then profile
    if _GITHUB_PROFILE_RE.match(url.rstrip("/")):
        return "profile"
    return None


def _is_github_url(url: str) -> bool:
    """Return True if this URL is a GitHub repository or profile."""
    return _classify_github_url(url) is not None


async def run_discovery(
    run_id: uuid.UUID,
    project_url: str,
    session: AsyncSession,
    deployment_url: str | None = None,
) -> None:
    """
    Execute full discovery pipeline for a project.

    This function runs as a background asyncio task.
    Updates the DiscoveryRun record directly with progress/results.

    Args:
        run_id:         The DiscoveryRun ID to update.
        project_url:    The target project URL (website or GitHub repo).
        session:        Async DB session (fresh session for background tasks).
        deployment_url: Optional deployment URL for GitHub repos to verify against.
    """
    logger.info("discovery_started", run_id=str(run_id), url=project_url)

    # Load the run
    run = await session.get(DiscoveryRun, run_id)
    if run is None:
        logger.error("discovery_run_not_found", run_id=str(run_id))
        return

    run.status = DiscoveryStatus.RUNNING.value
    run.started_at = datetime.now(UTC)
    await session.flush()
    await session.commit()

    provider_results: dict[str, dict] = {}
    all_candidates: list[dict] = []

    # Helper to flush progress to DB
    async def _update_progress(step: str, details: dict) -> None:
        try:
            state = {
                "step": step,
                "timestamp": datetime.now(UTC).isoformat(),
                "details": details,
            }
            run.progress_state = json.dumps(state)
            await session.flush()
            await session.commit()
        except Exception as e:
            logger.debug("progress_flush_failed", error=str(e))

    # -------------------------------------------------------------------------
    # Step 1: SSRF validation on the base URL
    # -------------------------------------------------------------------------
    try:
        await _update_progress("URL_VALIDATION", {"url": project_url})
        # GitHub URLs are not outbound targets for SSRF purposes — we use their API
        if not _is_github_url(project_url):
            validate_url_for_outbound(project_url, context="discovery_target")
    except SSRFBlockedError as exc:
        run.status = DiscoveryStatus.FAILED.value
        run.completed_at = datetime.now(UTC)
        run.error_message = f"Target URL blocked: {exc.message}"
        await session.flush()
        await session.commit()
        return

    # -------------------------------------------------------------------------
    # Step 2: Route to GitHub or Website discovery pipeline
    # -------------------------------------------------------------------------
    is_github_type = _classify_github_url(project_url)

    if is_github_type == "repo":
        await _run_github_discovery(
            run=run,
            project_url=project_url,
            deployment_url=deployment_url,
            session=session,
            provider_results=provider_results,
            all_candidates=all_candidates,
            update_progress=_update_progress,
        )
    elif is_github_type == "profile":
        await _run_github_profile_discovery(
            run=run,
            project_url=project_url,
            deployment_url=deployment_url,
            session=session,
            provider_results=provider_results,
            all_candidates=all_candidates,
            update_progress=_update_progress,
        )
    else:
        await _run_website_discovery(
            run=run,
            project_url=project_url,
            session=session,
            provider_results=provider_results,
            all_candidates=all_candidates,
            update_progress=_update_progress,
        )


async def _run_website_discovery(
    run: DiscoveryRun,
    project_url: str,
    session: AsyncSession,
    provider_results: dict,
    all_candidates: list,
    update_progress,
) -> None:
    """Full website/API discovery pipeline."""
    parsed = urlparse(project_url)
    base_root = f"{parsed.scheme}://{parsed.netloc}"

    # -------------------------------------------------------------------------
    # Step 2a & 2b: OpenAPI Discovery and Website Crawl (Concurrent)
    # -------------------------------------------------------------------------
    await update_progress("OPENAPI_AND_CRAWL", {"status": "starting_concurrent_tasks"})

    async def _crawl_cb(state: dict) -> None:
        await update_progress("CRAWLING", state)

    openapi_task = asyncio.create_task(discover_openapi(base_root))
    crawl_task = asyncio.create_task(
        crawl_website(project_url, max_depth=2, max_pages=50, progress_callback=_crawl_cb)
    )

    openapi_result = None
    try:
        openapi_result = await asyncio.wait_for(openapi_task, timeout=30.0)
        run.openapi_checked = True
        if openapi_result.found:
            run.openapi_found = True
            run.openapi_url = openapi_result.spec_url
            for ep in openapi_result.endpoints:
                all_candidates.append({
                    "method": ep.method,
                    "path": ep.path,
                    "full_url": ep.full_url,
                    "source": DiscoverySource.OPENAPI.value,
                    "confidence": DiscoveryConfidence.HIGH.value,
                    "operation_id": ep.operation_id,
                    "summary": ep.summary,
                    "tags": ",".join(ep.tags) if ep.tags else None,
                })
        provider_results["openapi"] = {
            "found": openapi_result.found,
            "spec_url": openapi_result.spec_url,
            "endpoints": len(openapi_result.endpoints),
        }
    except asyncio.TimeoutError:
        provider_results["openapi"] = {"error": "timeout"}
    except Exception as exc:
        provider_results["openapi"] = {"error": str(exc)[:200]}

    crawl_result = None
    js_urls: list[str] = []
    try:
        crawl_result = await asyncio.wait_for(crawl_task, timeout=90.0)
        run.crawl_checked = True

        # ── CRITICAL FIX: Only add API-pattern paths and JSON paths as candidates ──
        # We do NOT add page_paths — those are HTML pages, not APIs.
        # Examples of things we skip:
        #   /vi, /bg, /zh, /th, /de (locale routes)
        #   /about, /contact, /pricing (marketing pages)
        #   /blog/post-title (content pages)

        # API-pattern paths (e.g. /api/users, /v1/items, /graphql) → MEDIUM confidence
        for path in crawl_result.api_paths:
            full_url = urljoin(base_root, path)
            all_candidates.append({
                "method": "GET",
                "path": path,
                "full_url": full_url,
                "source": DiscoverySource.CRAWLER.value,
                "confidence": DiscoveryConfidence.MEDIUM.value,
            })

        # JSON response paths (confirmed JSON content-type) → MEDIUM confidence
        for path in crawl_result.json_paths:
            if path not in crawl_result.api_paths:  # avoid duplication
                full_url = urljoin(base_root, path)
                all_candidates.append({
                    "method": "GET",
                    "path": path,
                    "full_url": full_url,
                    "source": DiscoverySource.CRAWLER.value,
                    "confidence": DiscoveryConfidence.MEDIUM.value,
                })

        # NOTE: page_paths are intentionally NOT added as candidates.
        # They are HTML pages (locale routes, marketing pages, etc.) and
        # should never be listed as monitorable API endpoints.

        # Form action URLs → only POST endpoints that look like APIs → LOW confidence
        for path in crawl_result.form_paths:
            if path in crawl_result.api_paths or path in crawl_result.json_paths:
                continue
            # Only include if it looks like an API path
            from app.discovery.crawler import _API_PATH_PATTERNS as _CRAWLER_API_PATTERNS
            if any(p.search(path) for p in _CRAWLER_API_PATTERNS):
                full_url = urljoin(base_root, path)
                all_candidates.append({
                    "method": "POST",
                    "path": path,
                    "full_url": full_url,
                    "source": DiscoverySource.CRAWLER.value,
                    "confidence": DiscoveryConfidence.LOW.value,
                })

        js_urls = crawl_result.js_urls
        provider_results["crawler"] = {
            "pages_visited": crawl_result.pages_visited,
            "api_paths": len(crawl_result.api_paths),
            "json_paths": len(getattr(crawl_result, "json_paths", [])),
            "page_paths_skipped": len(getattr(crawl_result, "page_paths", [])),
            "js_files_found": len(crawl_result.js_urls),
        }
    except asyncio.TimeoutError:
        provider_results["crawler"] = {"error": "timeout"}
    except Exception as exc:
        provider_results["crawler"] = {"error": str(exc)[:200]}

    # -------------------------------------------------------------------------
    # Step 3: JavaScript Analysis
    # -------------------------------------------------------------------------
    await update_progress("JS_ANALYSIS", {"files_to_analyze": len(js_urls[:20])})
    try:
        js_result = await asyncio.wait_for(
            analyze_javascript(js_urls[:20], base_root),
            timeout=45.0,
        )
        run.js_checked = True
        for ep in js_result.endpoints:
            full_url = urljoin(base_root, ep.path)
            all_candidates.append({
                "method": ep.method,
                "path": ep.path,
                "full_url": full_url,
                "source": DiscoverySource.JAVASCRIPT.value,
                "confidence": DiscoveryConfidence.MEDIUM.value,
            })
        provider_results["javascript"] = {
            "files_analyzed": js_result.js_files_analyzed,
            "endpoints": len(js_result.endpoints),
        }
    except asyncio.TimeoutError:
        provider_results["javascript"] = {"error": "timeout"}
    except Exception as exc:
        provider_results["javascript"] = {"error": str(exc)[:200]}

    # -------------------------------------------------------------------------
    # Step 4: Deduplication & Verification
    # -------------------------------------------------------------------------
    await _deduplicate_verify_and_save(
        run=run,
        session=session,
        all_candidates=all_candidates,
        provider_results=provider_results,
        update_progress=update_progress,
        skip_verification=False,
    )


async def _run_github_discovery(
    run: DiscoveryRun,
    project_url: str,
    deployment_url: str | None,
    session: AsyncSession,
    provider_results: dict,
    all_candidates: list,
    update_progress,
) -> None:
    """GitHub repository source-code discovery pipeline."""
    await update_progress("GITHUB_ANALYSIS", {"url": project_url})

    try:
        from app.discovery.github import discover_github_repo
        github_result = await asyncio.wait_for(
            discover_github_repo(project_url, deployment_url=deployment_url),
            timeout=120.0,
        )
        run.github_checked = True

        for ep in github_result.endpoints:
            # If we have a deployment URL, build the full URL against it
            if deployment_url:
                parsed_deploy = urlparse(deployment_url.rstrip("/"))
                base_deploy = f"{parsed_deploy.scheme}://{parsed_deploy.netloc}"
                full_url = urljoin(base_deploy, ep.path)
            else:
                full_url = ep.path  # Just the path — no live URL

            all_candidates.append({
                "method": ep.method,
                "path": ep.path,
                "full_url": full_url,
                "source": DiscoverySource.GITHUB.value,
                "confidence": ep.confidence,
                "operation_id": ep.operation_id,
                "summary": ep.summary,
                "tags": ",".join(ep.tags) if ep.tags else None,
            })

        provider_results["github"] = {
            "found": True,
            "owner": github_result.owner,
            "repo": github_result.repo,
            "files_analyzed": github_result.files_analyzed,
            "endpoints": len(github_result.endpoints),
            "has_deployment_url": bool(deployment_url),
        }
    except asyncio.TimeoutError:
        provider_results["github"] = {"error": "timeout"}
        run.github_checked = True
    except Exception as exc:
        provider_results["github"] = {"error": str(exc)[:200]}
        run.github_checked = True

    # -------------------------------------------------------------------------
    # Deduplication & Verification (or mark NOT_VERIFIED if no deployment URL)
    # -------------------------------------------------------------------------
    await _deduplicate_verify_and_save(
        run=run,
        session=session,
        all_candidates=all_candidates,
        provider_results=provider_results,
        update_progress=update_progress,
        skip_verification=(deployment_url is None),
    )


async def _run_github_profile_discovery(
    run: DiscoveryRun,
    project_url: str,
    deployment_url: str | None,
    session: AsyncSession,
    provider_results: dict,
    all_candidates: list,
    update_progress,
) -> None:
    """
    GitHub profile/user discovery pipeline.

    Visits github.com/USERNAME?tab=repositories, parses public repository
    links from the HTML, then runs discover_github_repo on each (up to 5).

    This is intentionally read-only and does not execute any code.
    It respects rate limits by limiting concurrent requests.
    """
    import re as _re
    import httpx

    # Derive canonical profile URL and username
    parsed = urlparse(project_url)
    username = parsed.path.strip("/").split("/")[0]
    # The repositories page for the profile
    repos_page_url = f"https://github.com/{username}?tab=repositories"

    await update_progress("GITHUB_PROFILE_ANALYSIS", {"url": repos_page_url, "username": username})
    logger.info("github_profile_discovery_started", username=username, url=repos_page_url)

    repo_urls: list[str] = []

    try:
        async with httpx.AsyncClient(
            timeout=20.0,
            follow_redirects=True,
            headers={
                "User-Agent": "Mozilla/5.0 APIMonitor-Discovery/1.0",
                "Accept": "text/html,application/xhtml+xml",
            },
            limits=httpx.Limits(max_connections=2),
        ) as client:
            resp = await asyncio.wait_for(
                client.get(repos_page_url),
                timeout=20.0,
            )

            if resp.status_code == 200:
                html = resp.text
                # Extract links like /username/repo-name from the repository list
                # GitHub renders repo links as href="/owner/repo"
                pattern = _re.compile(
                    r'href="/(' + _re.escape(username) + r'/[A-Za-z0-9_.-]+)"',
                    _re.IGNORECASE,
                )
                found = pattern.findall(html)

                # Deduplicate and build full URLs
                seen_repos: set[str] = set()
                for owner_repo in found:
                    parts = owner_repo.strip("/").split("/")
                    if len(parts) != 2:
                        continue
                    owner, repo = parts[0], parts[1]
                    # Skip special GitHub repos like .github
                    if repo.startswith("."):
                        continue
                    key = f"{owner.lower()}/{repo.lower()}"
                    if key not in seen_repos:
                        seen_repos.add(key)
                        repo_urls.append(f"https://github.com/{owner}/{repo}")
                        if len(repo_urls) >= 5:  # Limit to 5 repos per profile
                            break

                logger.info(
                    "github_profile_repos_found",
                    username=username,
                    count=len(repo_urls),
                    repos=repo_urls,
                )
            else:
                logger.warning(
                    "github_profile_page_error",
                    username=username,
                    status_code=resp.status_code,
                )
    except Exception as exc:
        logger.warning("github_profile_fetch_error", username=username, error=str(exc)[:200])

    if not repo_urls:
        provider_results["github"] = {
            "error": f"No public repositories found for user '{username}'. "
                     "The profile may be private or have no public repos.",
            "profile_url": repos_page_url,
        }
        run.github_checked = True
        await _deduplicate_verify_and_save(
            run=run,
            session=session,
            all_candidates=all_candidates,
            provider_results=provider_results,
            update_progress=update_progress,
            skip_verification=(deployment_url is None),
        )
        return

    # Analyze each discovered repository
    from app.discovery.github import discover_github_repo

    repo_results = []
    total_endpoints = 0
    total_files = 0

    for repo_url in repo_urls:
        await update_progress("GITHUB_REPO_ANALYSIS", {"repo_url": repo_url})
        try:
            github_result = await asyncio.wait_for(
                discover_github_repo(repo_url, deployment_url=deployment_url),
                timeout=90.0,
            )

            for ep in github_result.endpoints:
                if deployment_url:
                    parsed_deploy = urlparse(deployment_url.rstrip("/"))
                    base_deploy = f"{parsed_deploy.scheme}://{parsed_deploy.netloc}"
                    full_url = urljoin(base_deploy, ep.path)
                else:
                    full_url = ep.path  # Just the path — no live URL

                all_candidates.append({
                    "method": ep.method,
                    "path": ep.path,
                    "full_url": full_url,
                    "source": DiscoverySource.GITHUB.value,
                    "confidence": ep.confidence,
                    "operation_id": ep.operation_id,
                    "summary": ep.summary,
                    "tags": ",".join(ep.tags) if ep.tags else None,
                })

            total_endpoints += len(github_result.endpoints)
            total_files += github_result.files_analyzed
            repo_results.append({
                "repo": repo_url,
                "owner": github_result.owner,
                "repo_name": github_result.repo,
                "files_analyzed": github_result.files_analyzed,
                "endpoints": len(github_result.endpoints),
                "error": github_result.error,
            })

        except asyncio.TimeoutError:
            repo_results.append({"repo": repo_url, "error": "timeout"})
        except Exception as exc:
            repo_results.append({"repo": repo_url, "error": str(exc)[:200]})

    run.github_checked = True
    provider_results["github"] = {
        "found": True,
        "type": "profile",
        "username": username,
        "repositories_discovered": len(repo_urls),
        "repositories_analyzed": repo_results,
        "total_files_analyzed": total_files,
        "total_endpoints": total_endpoints,
        "has_deployment_url": bool(deployment_url),
    }

    await _deduplicate_verify_and_save(
        run=run,
        session=session,
        all_candidates=all_candidates,
        provider_results=provider_results,
        update_progress=update_progress,
        skip_verification=(deployment_url is None),
    )




async def _deduplicate_verify_and_save(
    run: DiscoveryRun,
    session: AsyncSession,
    all_candidates: list[dict],
    provider_results: dict,
    update_progress,
    skip_verification: bool = False,
) -> None:
    """
    Deduplicate candidates, verify them (unless skipped), persist everything.
    """
    # -------------------------------------------------------------------------
    # Deduplication
    # -------------------------------------------------------------------------
    await update_progress("DEDUPLICATION", {"total_candidates": len(all_candidates)})

    confidence_rank = {
        DiscoveryConfidence.HIGH.value: 3,
        DiscoveryConfidence.MEDIUM.value: 2,
        DiscoveryConfidence.LOW.value: 1,
    }
    source_rank = {
        DiscoverySource.OPENAPI.value: 4,
        DiscoverySource.GITHUB.value: 3,
        DiscoverySource.JAVASCRIPT.value: 2,
        DiscoverySource.CRAWLER.value: 1,
        DiscoverySource.MANUAL.value: 0,
    }

    seen: dict[tuple[str, str], dict] = {}
    for c in all_candidates:
        key = (c["method"].upper(), c["path"])
        if key not in seen:
            seen[key] = c
        else:
            existing = seen[key]
            # Prefer higher confidence, then higher source rank
            c_conf = confidence_rank.get(c["confidence"], 0)
            e_conf = confidence_rank.get(existing["confidence"], 0)
            c_src = source_rank.get(c["source"], 0)
            e_src = source_rank.get(existing["source"], 0)
            if (c_conf, c_src) > (e_conf, e_src):
                seen[key] = c

    unique_candidates = list(seen.values())
    project_id = run.project_id

    # Persist candidates early as PENDING so UI can display them
    db_candidates_map: dict[tuple[str, str], DiscoveryCandidate] = {}
    initial_vs = (
        VerificationStatus.NOT_VERIFIED.value
        if skip_verification
        else VerificationStatus.PENDING.value
    )

    for c in unique_candidates:
        candidate = DiscoveryCandidate(
            run_id=str(run.id),
            project_id=project_id,
            method=c["method"],
            path=c["path"],
            full_url=c["full_url"],
            source=c["source"],
            confidence=c["confidence"],
            operation_id=c.get("operation_id"),
            summary=c.get("summary"),
            tags=c.get("tags"),
            verification_status=initial_vs,
        )
        session.add(candidate)
        db_candidates_map[(c["method"].upper(), c["full_url"])] = candidate

    await session.commit()

    # -------------------------------------------------------------------------
    # Verification (skipped for GitHub without deployment URL)
    # -------------------------------------------------------------------------
    verified_count = 0
    unavailable_count = 0
    blocked_count = 0
    web_page_count = 0
    auth_required_count = 0

    if not skip_verification and unique_candidates:
        await update_progress("VERIFICATION", {"unique_candidates": len(unique_candidates)})
        # Build verification batch: (url, method, source)
        to_verify = [
            (c["full_url"], c["method"], c["source"])
            for c in unique_candidates
        ]

        try:
            results = await asyncio.wait_for(
                verify_batch(to_verify),
                timeout=120.0,
            )
            for result in results:
                key = (result.method.upper(), result.url)
                candidate = db_candidates_map.get(key)
                if not candidate:
                    continue

                candidate.verification_status = result.status
                candidate.http_status = result.http_status
                candidate.response_time_ms = result.response_time_ms
                candidate.verification_error = result.error

                if result.status == "VERIFIED":
                    verified_count += 1
                elif result.status == "WEB_PAGE":
                    web_page_count += 1
                elif result.status == "AUTH_REQUIRED":
                    auth_required_count += 1
                elif result.status == "UNAVAILABLE":
                    unavailable_count += 1
                elif result.status == "BLOCKED":
                    blocked_count += 1

        except asyncio.TimeoutError:
            provider_results["verification"] = {"error": "timeout"}

    # -------------------------------------------------------------------------
    # Update run record
    # -------------------------------------------------------------------------
    await update_progress("COMPLETED", {"status": "success"})

    run.status = DiscoveryStatus.COMPLETED.value
    run.completed_at = datetime.now(UTC)
    run.candidates_total = len(unique_candidates)
    run.candidates_verified = verified_count
    run.candidates_unavailable = unavailable_count + web_page_count
    run.candidates_blocked = blocked_count
    run.provider_results = json.dumps({
        **provider_results,
        "summary": {
            "total": len(unique_candidates),
            "verified": verified_count,
            "web_page": web_page_count,
            "auth_required": auth_required_count,
            "unavailable": unavailable_count,
            "blocked": blocked_count,
            "not_verified": len(unique_candidates) if skip_verification else 0,
        }
    })

    await session.flush()
    await session.commit()

    logger.info(
        "discovery_completed",
        run_id=str(run.id),
        total=len(unique_candidates),
        verified=verified_count,
        web_page=web_page_count,
        auth_required=auth_required_count,
    )
