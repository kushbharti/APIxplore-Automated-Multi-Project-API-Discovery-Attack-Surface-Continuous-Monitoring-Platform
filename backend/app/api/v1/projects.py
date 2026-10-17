"""
app/api/v1/projects.py
========================
Project management routes.

All routes are unauthenticated — the platform is for internal/team use
without individual login. Security is handled at the network/infra level
(VPN, firewall). URL input validation includes SSRF protection.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.core.ssrf import validate_url_for_outbound, validate_domain_allowlist
from app.core.exceptions import SSRFBlockedError
from app.core.config import get_settings
from app.db.session import get_db
from app.models.project import Project
from app.repositories.project import ProjectRepository
from app.schemas.common import DataResponse
from app.schemas.project import ProjectCreate, ProjectOut, ProjectSummary, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["Projects"])


@router.get("", response_model=DataResponse[list[ProjectSummary]])
async def list_projects(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(100, ge=1, le=500),
) -> DataResponse[list[ProjectSummary]]:
    """List all projects with summary stats."""
    rid = getattr(request.state, "request_id", "unknown")
    repo = ProjectRepository(session)
    projects = await repo.get_all(limit=limit)
    return DataResponse(
        data=[ProjectSummary.model_validate(p) for p in projects],
        request_id=rid,
    )


@router.post("", response_model=DataResponse[ProjectOut], status_code=status.HTTP_201_CREATED)
async def create_project(
    body: ProjectCreate,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> DataResponse[ProjectOut]:
    """
    Create a new project.

    The target URL is validated before saving.
    GitHub repository URLs skip SSRF validation (we use the GitHub API, not the URL directly).
    Website/API URLs are validated against SSRF rules.
    """
    rid = getattr(request.state, "request_id", "unknown")
    settings = get_settings()

    original_url = body.url.strip()

    # SSRF validation on target URL
    try:
        validate_url_for_outbound(original_url, context="project_create")
        validate_domain_allowlist(original_url, settings.allowed_domains)
    except SSRFBlockedError as exc:
        raise exc
    except ValueError as exc:
        raise SSRFBlockedError(str(exc)) from exc

    repo = ProjectRepository(session)
    existing = await repo.get_by_url(original_url)
    if existing:
        return DataResponse(data=ProjectOut.model_validate(existing), request_id=rid)

    # Exact target URL entered by user is preserved throughout project lifecycle
    project = Project(
        name=body.name,
        url=original_url,
        description=body.description,
        source_type=body.source_type,
        deployment_url=body.deployment_url.strip() if body.deployment_url else None,
    )
    created = await repo.create(project)
    return DataResponse(data=ProjectOut.model_validate(created), request_id=rid)



@router.get("/{project_id}", response_model=DataResponse[ProjectOut])
async def get_project(
    project_id: uuid.UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> DataResponse[ProjectOut]:
    """Get a project by ID with full stats."""
    rid = getattr(request.state, "request_id", "unknown")
    repo = ProjectRepository(session)
    project = await repo.get_by_id(project_id)
    if project is None:
        raise NotFoundError("Project", str(project_id))
    return DataResponse(data=ProjectOut.model_validate(project), request_id=rid)


@router.patch("/{project_id}", response_model=DataResponse[ProjectOut])
async def update_project(
    project_id: uuid.UUID,
    body: ProjectUpdate,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> DataResponse[ProjectOut]:
    """Update project name, URL, or description."""
    rid = getattr(request.state, "request_id", "unknown")
    repo = ProjectRepository(session)
    project = await repo.get_by_id(project_id)
    if project is None:
        raise NotFoundError("Project", str(project_id))

    # SSRF validation if URL is being changed
    if body.url is not None:
        settings = get_settings()
        try:
            validate_url_for_outbound(body.url, context="project_update")
            validate_domain_allowlist(body.url, settings.allowed_domains)
        except SSRFBlockedError as exc:
            raise exc
        except ValueError as exc:
            raise SSRFBlockedError(str(exc)) from exc

    updates = body.model_dump(exclude_none=True)
    updated = await repo.update(project, updates)
    return DataResponse(data=ProjectOut.model_validate(updated), request_id=rid)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    """Delete a project and all its endpoints and discovery runs."""
    repo = ProjectRepository(session)
    project = await repo.get_by_id(project_id)
    if project is None:
        raise NotFoundError("Project", str(project_id))
    await repo.delete(project)
