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
from typing import Any
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

async def run_discovery(
    run_id: uuid.UUID,
    project_url: str,
    session: AsyncSession,
    deployment_url: str | None = None,
    auth_config: Any | None = None,
) -> None:
    """
    Execute full discovery pipeline for a project.

    This function runs as a background asyncio task.
    Updates the DiscoveryRun record directly with progress/results.

    Args:
        run_id:         The DiscoveryRun ID to update.
        project_url:    The target project URL (website or API).
        session:        Async DB session (fresh session for background tasks).
        deployment_url: Optional secondary deployment URL.
        auth_config:    Optional target credentials or OAuth token for login-protected sites.
    """
    logger.info("discovery_started", run_id=str(run_id), url=project_url)

    # Load the run
    run = await session.get(DiscoveryRun, str(run_id))
    if run is None:
        logger.error("discovery_run_not_found", run_id=str(run_id))
        return

    run.status = DiscoveryStatus.RUNNING.value
    run.started_at = datetime.now(UTC)
    await session.flush()
    await session.commit()

    provider_results: dict[str, dict] = {}
    all_candidates: list[dict] = []

    # Build ephemeral auth headers if credentials / OAuth token provided
    auth_headers: dict[str, str] = {}
    if auth_config:
        auth_type = getattr(auth_config, "auth_type", None) or (
            auth_config.get("auth_type") if isinstance(auth_config, dict) else None
        )
        oauth_token = getattr(auth_config, "oauth_token", None) or (
            auth_config.get("oauth_token") if isinstance(auth_config, dict) else None
        )
        username = getattr(auth_config, "username_or_email", None) or (
            auth_config.get("username_or_email") if isinstance(auth_config, dict) else None
        )
        password = getattr(auth_config, "password", None) or (
            auth_config.get("password") if isinstance(auth_config, dict) else None
        )

        if auth_type == "GOOGLE_OAUTH" and oauth_token:
            auth_headers["Authorization"] = f"Bearer {oauth_token}"
        elif username or password:
            import base64
            encoded = base64.b64encode(f"{username or ''}:{password or ''}".encode("utf-8")).decode("ascii")
            auth_headers["Authorization"] = f"Basic {encoded}"

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
        validate_url_for_outbound(project_url, context="discovery_target")
    except SSRFBlockedError as exc:
        run.status = DiscoveryStatus.FAILED.value
        run.completed_at = datetime.now(UTC)
        run.error_message = f"Target URL blocked: {exc.message}"
        await session.flush()
        await session.commit()
        return

    # Check for unsupported direct GitHub target without deployment URL
    parsed = urlparse(project_url)
    if parsed.netloc in ("github.com", "www.github.com") and not deployment_url:
        run.status = DiscoveryStatus.FAILED.value
        run.completed_at = datetime.now(UTC)
        run.error_message = (
            "Direct GitHub repository discovery is unsupported without a live deployment URL. "
            "Please configure a live Deployment URL to discover and verify API endpoints."
        )
        await _update_progress("FAILED", {"error": run.error_message})
        await session.flush()
        await session.commit()
        return

    # -------------------------------------------------------------------------
    # Step 2: Website & API discovery pipeline
    # -------------------------------------------------------------------------
    try:
        await _run_website_discovery(
            run=run,
            project_url=project_url,
            session=session,
            provider_results=provider_results,
            all_candidates=all_candidates,
            update_progress=_update_progress,
            auth_headers=auth_headers,
            deployment_url=deployment_url,
        )
    except Exception as exc:
        logger.exception("discovery_pipeline_failed", run_id=str(run_id), error=str(exc))
        run.status = DiscoveryStatus.FAILED.value
        run.completed_at = datetime.now(UTC)
        run.error_message = f"Discovery execution failed: {str(exc)}"
        await _update_progress("FAILED", {"error": str(exc)})
        await session.flush()
        await session.commit()


async def _run_website_discovery(
    run: DiscoveryRun,
    project_url: str,
    session: AsyncSession,
    provider_results: dict,
    all_candidates: list,
    update_progress,
    auth_headers: dict[str, str] | None = None,
    deployment_url: str | None = None,
) -> None:
    """Full website/API discovery pipeline."""
    parsed = urlparse(project_url)
    base_root = f"{parsed.scheme}://{parsed.netloc}"

    # If a separate deployment URL is provided, use it as the crawl/probe target
    # (e.g., GitHub repo URL as project_url, but live site at deployment_url)
    effective_crawl_url = deployment_url if deployment_url else project_url
    if deployment_url:
        effective_parsed = urlparse(deployment_url)
        base_root = f"{effective_parsed.scheme}://{effective_parsed.netloc}"

    # -------------------------------------------------------------------------
    # Step 2a & 2b: OpenAPI Discovery and Website Crawl (Concurrent)
    # -------------------------------------------------------------------------
    await update_progress("OPENAPI_AND_CRAWL", {"status": "starting_concurrent_tasks"})

    async def _crawl_cb(state: dict) -> None:
        await update_progress("CRAWLING", state)

    openapi_task = asyncio.create_task(discover_openapi(effective_crawl_url, headers=auth_headers))
    crawl_task = asyncio.create_task(
        crawl_website(effective_crawl_url, max_depth=3, max_pages=80, progress_callback=_crawl_cb, headers=auth_headers)
    )

    openapi_result = None
    try:
        openapi_result = await asyncio.wait_for(openapi_task, timeout=40.0)
        run.openapi_checked = True
        if openapi_result and openapi_result.found:
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
                "found": True,
                "spec_url": openapi_result.spec_url,
                "endpoints": len(openapi_result.endpoints),
            }
        else:
            run.openapi_found = False
            provider_results["openapi"] = {
                "found": False,
                "endpoints": 0,
            }
    except asyncio.TimeoutError:
        run.openapi_checked = True
        run.openapi_found = False
        provider_results["openapi"] = {"found": False, "error": "timeout"}
    except Exception as exc:
        run.openapi_checked = True
        run.openapi_found = False
        provider_results["openapi"] = {"found": False, "error": str(exc)[:200]}
    finally:
        run.openapi_checked = True
        await session.flush()
        await session.commit()

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
            if ep.path.startswith(("http://", "https://")):
                full_url = ep.path
                parsed_ep = urlparse(ep.path)
                path = parsed_ep.path or "/"
                if parsed_ep.query:
                    path += f"?{parsed_ep.query}"
            else:
                path = ep.path
                full_url = urljoin(base_root, ep.path)
            all_candidates.append({
                "method": ep.method,
                "path": path,
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
        auth_headers=auth_headers,
    )





async def _deduplicate_verify_and_save(
    run: DiscoveryRun,
    session: AsyncSession,
    all_candidates: list[dict],
    provider_results: dict,
    update_progress,
    skip_verification: bool = False,
    auth_headers: dict[str, str] | None = None,
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
        DiscoverySource.OPENAPI.value: 3,
        DiscoverySource.JAVASCRIPT.value: 2,
        DiscoverySource.CRAWLER.value: 1,
        DiscoverySource.MANUAL.value: 0,
    }

    seen: dict[tuple[str, str], dict] = {}
    for c in all_candidates:
        key = (c["method"].upper(), c["full_url"])
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
                verify_batch(to_verify, headers=auth_headers),
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
                candidate.verification_error = result.diagnostic_notes or result.error

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
