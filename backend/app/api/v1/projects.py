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

    import re
    from urllib.parse import urlparse, urlunparse

    # Matches both profile URLs (github.com/USER) and repo URLs (github.com/USER/REPO)
    _GITHUB_RE = re.compile(
        r"^https?://(?:www\.)?github\.com/[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)?/?(?:\?.*)?$",
        re.IGNORECASE,
    )
    is_github = bool(_GITHUB_RE.match(body.url))

    # Normalize URL
    parsed = urlparse(body.url)
    if is_github:
        # For GitHub URLs: store a clean canonical URL without query string or trailing slash.
        # Strip scheme to lowercase, remove trailing slashes from the path, drop query/fragment.
        clean_path = parsed.path.rstrip("/")
        normalized_url = f"https://github.com{clean_path}"
    else:
        scheme = parsed.scheme if parsed.scheme else "https"
        netloc = parsed.netloc if parsed.netloc else parsed.path
        normalized_url = f"{scheme}://{netloc.lower()}".rstrip("/")

    # SSRF validation — skip for GitHub (we use their API)
    if not is_github:
        try:
            validate_url_for_outbound(normalized_url, context="project_create")
            validate_domain_allowlist(normalized_url, settings.allowed_domains)
        except SSRFBlockedError as exc:
            raise exc
        except ValueError as exc:
            raise SSRFBlockedError(str(exc)) from exc

    repo = ProjectRepository(session)
    existing = await repo.get_by_url(normalized_url)
    if existing:
        return DataResponse(data=ProjectOut.model_validate(existing), request_id=rid)

    source_type = body.source_type
    if is_github and source_type == "WEBSITE":
        source_type = "GITHUB_REPOSITORY"

    project = Project(
        name=body.name,
        url=normalized_url,
        description=body.description,
        source_type=source_type,
        deployment_url=body.deployment_url,
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
