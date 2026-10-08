"""
app/api/v1/discovery.py
========================
Discovery routes — start and inspect endpoint discovery runs.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Annotated

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, SSRFBlockedError
from app.core.ssrf import validate_url_for_outbound
from app.db.session import get_db, get_session_factory
from app.models.discovery_run import DiscoveryRun, DiscoveryStatus
from app.models.endpoint import (
    DiscoveryConfidence,
    DiscoverySource,
    Endpoint,
    HealthState,
)
from app.repositories.discovery import DiscoveryCandidateRepository, DiscoveryRunRepository
from app.repositories.project import ProjectRepository
from app.schemas.common import DataResponse
from app.schemas.project import (
    AcceptCandidatesRequest,
    DiscoveryCandidateOut,
    DiscoveryRunOut,
)

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["Discovery"])


@router.post(
    "/projects/{project_id}/discover",
    response_model=DataResponse[DiscoveryRunOut],
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_discovery(
    project_id: uuid.UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
    background_tasks: BackgroundTasks,
) -> DataResponse[DiscoveryRunOut]:
    """
    Start a discovery run for the project.

    Returns immediately with the run ID. Discovery runs in the background.
    Poll GET /projects/{id}/discovery/{run_id} for status.
    """
    import re as _re
    rid = getattr(request.state, "request_id", "unknown")

    proj_repo = ProjectRepository(session)
    project = await proj_repo.get_by_id(project_id)
    if project is None:
        raise NotFoundError("Project", str(project_id))

    # Validate project URL before starting — skip SSRF for GitHub repos
    # Matches both github.com/USER/REPO (repo) and github.com/USER (profile)
    _GITHUB_RE = _re.compile(
        r"^https?://(?:www\.)?github\.com/[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)?/?(?:\?.*)?$",
        _re.IGNORECASE,
    )
    is_github = bool(_GITHUB_RE.match(project.url))

    if not is_github:
        try:
            validate_url_for_outbound(project.url, context="discovery_start")
        except SSRFBlockedError as exc:
            raise exc

    # Create the run record (PENDING)
    run = DiscoveryRun(
        project_id=str(project_id),
        status=DiscoveryStatus.PENDING.value,
    )
    run_repo = DiscoveryRunRepository(session)
    created_run = await run_repo.create(run)
    await session.commit()

    run_id = created_run.id
    project_url = project.url
    deployment_url = getattr(project, "deployment_url", None)

    # Launch discovery in the background (fresh session)
    async def _run_discovery() -> None:
        from app.discovery.manager import run_discovery
        factory = get_session_factory()
        async with factory() as bg_session:
            try:
                await run_discovery(
                    uuid.UUID(str(run_id)),
                    project_url,
                    bg_session,
                    deployment_url=deployment_url,
                )
            except Exception:
                logger.exception("background_discovery_failed", run_id=str(run_id))
                bg_run = await bg_session.get(DiscoveryRun, run_id)
                if bg_run:
                    bg_run.status = DiscoveryStatus.FAILED.value
                    bg_run.error_message = "An unexpected error occurred during discovery."
                    await bg_session.flush()
                    await bg_session.commit()

    background_tasks.add_task(_run_discovery)

    return DataResponse(data=DiscoveryRunOut.model_validate(created_run), request_id=rid)


@router.get(
    "/projects/{project_id}/discovery",
    response_model=DataResponse[list[DiscoveryRunOut]],
)
async def list_discovery_runs(
    project_id: uuid.UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(20, ge=1, le=100),
) -> DataResponse[list[DiscoveryRunOut]]:
    """List all discovery runs for a project, newest first."""
    rid = getattr(request.state, "request_id", "unknown")
    proj_repo = ProjectRepository(session)
    if await proj_repo.get_by_id(project_id) is None:
        raise NotFoundError("Project", str(project_id))

    run_repo = DiscoveryRunRepository(session)
    runs = await run_repo.get_for_project(project_id, limit=limit)
    return DataResponse(
        data=[DiscoveryRunOut.model_validate(r) for r in runs],
        request_id=rid,
    )


@router.get(
    "/projects/{project_id}/discovery/{run_id}",
    response_model=DataResponse[DiscoveryRunOut],
)
async def get_discovery_run(
    project_id: uuid.UUID,
    run_id: uuid.UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> DataResponse[DiscoveryRunOut]:
    """Get discovery run details."""
    rid = getattr(request.state, "request_id", "unknown")
    run_repo = DiscoveryRunRepository(session)
    run = await run_repo.get_by_id(run_id)
    if run is None or run.project_id != str(project_id):
        raise NotFoundError("DiscoveryRun", str(run_id))
    return DataResponse(data=DiscoveryRunOut.model_validate(run), request_id=rid)


@router.get(
    "/discovery/{run_id}/candidates",
    response_model=DataResponse[list[DiscoveryCandidateOut]],
)
async def get_discovery_candidates(
    run_id: uuid.UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    status_filter: str | None = Query(None, alias="status", description="Filter by verification_status"),
    source_filter: str | None = Query(None, alias="source", description="Filter by source"),
) -> DataResponse[list[DiscoveryCandidateOut]]:
    """Get candidates from a discovery run with optional pagination and filtering."""
    rid = getattr(request.state, "request_id", "unknown")
    run_repo = DiscoveryRunRepository(session)
    run = await run_repo.get_by_id(run_id)
    if run is None:
        raise NotFoundError("DiscoveryRun", str(run_id))

    candidate_repo = DiscoveryCandidateRepository(session)
    candidates = await candidate_repo.get_for_run(
        run_id,
        limit=limit,
        offset=offset,
        status_filter=status_filter,
        source_filter=source_filter,
    )
    total = await candidate_repo.count_for_run(run_id, status_filter=status_filter)
    return DataResponse(
        data=[DiscoveryCandidateOut.model_validate(c) for c in candidates],
        request_id=rid,
        meta={"total": total, "limit": limit, "offset": offset},
    )


@router.post(
    "/discovery/{run_id}/accept",
    response_model=DataResponse[dict],
)
async def accept_candidates(
    run_id: uuid.UUID,
    body: AcceptCandidatesRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> DataResponse[dict]:
    """
    Accept selected discovery candidates as monitored endpoints.

    Creates Endpoint records for each accepted candidate and
    marks the candidates as accepted.
    """
    rid = getattr(request.state, "request_id", "unknown")

    run_repo = DiscoveryRunRepository(session)
    run = await run_repo.get_by_id(run_id)
    if run is None:
        raise NotFoundError("DiscoveryRun", str(run_id))

    candidate_repo = DiscoveryCandidateRepository(session)
    created_count = 0
    skipped_count = 0

    for cid in body.candidate_ids:
        candidate = await candidate_repo.get_by_id(cid)
        if candidate is None or candidate.run_id != str(run_id):
            skipped_count += 1
            continue
        if candidate.accepted:
            skipped_count += 1
            continue

        # Map discovery confidence to endpoint confidence
        confidence_map = {
            "HIGH": DiscoveryConfidence.HIGH.value,
            "MEDIUM": DiscoveryConfidence.MEDIUM.value,
            "LOW": DiscoveryConfidence.LOW.value,
        }
        source_map = {
            "OPENAPI": DiscoverySource.OPENAPI.value,
            "CRAWLER": DiscoverySource.CRAWLER.value,
            "JAVASCRIPT": DiscoverySource.JAVASCRIPT.value,
            "GITHUB": DiscoverySource.GITHUB.value if hasattr(DiscoverySource, "GITHUB") else DiscoverySource.MANUAL.value,
        }

        # Generate a name from the candidate
        name = candidate.operation_id or f"{candidate.method} {candidate.path}"
        if len(name) > 200:
            name = name[:197] + "..."

        endpoint = Endpoint(
            project_id=run.project_id,
            name=name,
            description=candidate.summary,
            method=candidate.method,
            url=candidate.full_url,
            path=candidate.path,
            discovery_source=source_map.get(candidate.source, DiscoverySource.MANUAL.value),
            confidence=confidence_map.get(candidate.confidence, DiscoveryConfidence.MEDIUM.value),
            check_interval_seconds=body.check_interval_seconds,
            failure_threshold=body.failure_threshold,
            latency_threshold_ms=body.latency_threshold_ms,
            timeout_ms=body.timeout_ms,
            enabled=body.enabled,
            health_state=HealthState.UNKNOWN.value,
            tags=candidate.tags,
        )
        session.add(endpoint)
        await session.flush()

        # Mark candidate as accepted
        await candidate_repo.mark_accepted(cid, uuid.UUID(str(endpoint.id)))
        created_count += 1

    if created_count > 0:
        from app.models.project import Project
        project = await session.get(Project, uuid.UUID(run.project_id))
        if project:
            project.endpoint_count += created_count
            await session.flush()

    logger.info(
        "candidates_accepted",
        run_id=str(run_id),
        created=created_count,
        skipped=skipped_count,
    )

    return DataResponse(
        data={"created": created_count, "skipped": skipped_count},
        request_id=rid,
    )
