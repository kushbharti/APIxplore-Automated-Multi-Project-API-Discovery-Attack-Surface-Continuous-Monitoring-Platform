"""
app/api/v1/endpoints.py
========================
Endpoint CRUD routes, health history, and monitoring controls.
Authentication removed — the platform is for internal team use.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ssrf import validate_url_for_outbound
from app.core.exceptions import NotFoundError, SSRFBlockedError
from app.db.session import get_db
from app.monitoring.checker import run_check
from app.repositories.endpoint import EndpointRepository, HealthCheckRepository
from app.schemas.common import DataResponse
from app.schemas.endpoint import EndpointCreate, EndpointOut, EndpointSummary, EndpointUpdate
from app.schemas.incident import HealthCheckOut
from app.schemas.monitoring import MonitoringConfigOut, MonitoringConfigUpdate
from app.services.endpoint import EndpointService

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/endpoints", tags=["Endpoints"])


def _svc(session: Annotated[AsyncSession, Depends(get_db)]) -> EndpointService:
    return EndpointService(session)


SvcDep = Annotated[EndpointService, Depends(_svc)]


@router.post(
    "",
    response_model=DataResponse[EndpointOut],
    status_code=status.HTTP_201_CREATED,
)
async def create_endpoint(
    body: EndpointCreate, request: Request, svc: SvcDep
) -> DataResponse[EndpointOut]:
    """Create a new monitored endpoint."""
    rid = getattr(request.state, "request_id", "unknown")

    # SSRF validation
    try:
        validate_url_for_outbound(body.url, context="endpoint_create")
    except SSRFBlockedError as exc:
        raise exc
    except ValueError as exc:
        raise SSRFBlockedError(str(exc)) from exc

    return DataResponse(data=await svc.create(body), request_id=rid)


@router.get("", response_model=DataResponse[list[EndpointSummary]])
async def list_endpoints(
    request: Request,
    svc: SvcDep,
    enabled_only: bool = Query(False),
    project_id: uuid.UUID | None = Query(None),
    health_state: str | None = Query(None),
) -> DataResponse[list[EndpointSummary]]:
    """List all endpoints with optional filters."""
    rid = getattr(request.state, "request_id", "unknown")
    endpoints = await svc.list_all(
        enabled_only=enabled_only,
        project_id=project_id,
        health_state=health_state,
    )
    return DataResponse(data=endpoints, request_id=rid)


@router.get("/{endpoint_id}", response_model=DataResponse[EndpointOut])
async def get_endpoint(
    endpoint_id: uuid.UUID, request: Request, svc: SvcDep
) -> DataResponse[EndpointOut]:
    """Get endpoint details."""
    rid = getattr(request.state, "request_id", "unknown")
    return DataResponse(data=await svc.get(endpoint_id), request_id=rid)


@router.patch("/{endpoint_id}", response_model=DataResponse[EndpointOut])
async def update_endpoint(
    endpoint_id: uuid.UUID,
    body: EndpointUpdate,
    request: Request,
    svc: SvcDep,
) -> DataResponse[EndpointOut]:
    """Update endpoint configuration."""
    rid = getattr(request.state, "request_id", "unknown")

    # SSRF validation if URL is being changed
    if body.url is not None:
        try:
            validate_url_for_outbound(body.url, context="endpoint_update")
        except SSRFBlockedError as exc:
            raise exc
        except ValueError as exc:
            raise SSRFBlockedError(str(exc)) from exc

    return DataResponse(data=await svc.update(endpoint_id, body), request_id=rid)


@router.delete("/{endpoint_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_endpoint(endpoint_id: uuid.UUID, svc: SvcDep) -> None:
    """Delete an endpoint and its health check history."""
    await svc.delete(endpoint_id)


@router.patch("/{endpoint_id}/toggle", response_model=DataResponse[EndpointOut])
async def toggle_endpoint(
    endpoint_id: uuid.UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
    enabled: bool = Query(..., description="Enable or disable monitoring"),
) -> DataResponse[EndpointOut]:
    """Enable or disable monitoring for an endpoint."""
    rid = getattr(request.state, "request_id", "unknown")
    svc = EndpointService(session)
    result = await svc.toggle_enabled(endpoint_id, enabled)
    return DataResponse(data=result, request_id=rid)


@router.get("/{endpoint_id}/monitoring", response_model=DataResponse[MonitoringConfigOut])
async def get_endpoint_monitoring(
    endpoint_id: uuid.UUID,
    request: Request,
    svc: SvcDep,
) -> DataResponse[MonitoringConfigOut]:
    """Get monitoring configuration and calculated next_check."""
    from datetime import timedelta
    rid = getattr(request.state, "request_id", "unknown")
    endpoint = await svc.get(endpoint_id)

    next_check = None
    if endpoint.enabled:
        if endpoint.last_checked_at:
            next_check = endpoint.last_checked_at + timedelta(seconds=endpoint.check_interval_seconds)
        else:
            next_check = datetime.now(UTC)

    data = MonitoringConfigOut(
        enabled=endpoint.enabled,
        interval_seconds=endpoint.check_interval_seconds,
        last_check=endpoint.last_checked_at,
        next_check=next_check,
        status=endpoint.health_state,
    )
    return DataResponse(data=data, request_id=rid)


@router.patch("/{endpoint_id}/monitoring", response_model=DataResponse[MonitoringConfigOut])
async def update_endpoint_monitoring(
    endpoint_id: uuid.UUID,
    body: MonitoringConfigUpdate,
    request: Request,
    svc: SvcDep,
) -> DataResponse[MonitoringConfigOut]:
    """Update monitoring configuration (enabled, interval)."""
    from datetime import timedelta
    rid = getattr(request.state, "request_id", "unknown")

    # Reuse existing update logic
    update_data = EndpointUpdate()
    if body.enabled is not None:
        update_data.enabled = body.enabled
    if body.interval_seconds is not None:
        update_data.check_interval_seconds = body.interval_seconds

    if update_data.model_dump(exclude_unset=True):
        endpoint = await svc.update(endpoint_id, update_data)
    else:
        endpoint = await svc.get(endpoint_id)

    next_check = None
    if endpoint.enabled:
        if endpoint.last_checked_at:
            next_check = endpoint.last_checked_at + timedelta(seconds=endpoint.check_interval_seconds)
        else:
            next_check = datetime.now(UTC)

    data = MonitoringConfigOut(
        enabled=endpoint.enabled,
        interval_seconds=endpoint.check_interval_seconds,
        last_check=endpoint.last_checked_at,
        next_check=next_check,
        status=endpoint.health_state,
    )
    return DataResponse(data=data, request_id=rid)


@router.post("/{endpoint_id}/check", response_model=DataResponse[HealthCheckOut])
async def check_endpoint_now(
    endpoint_id: uuid.UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> DataResponse[HealthCheckOut]:
    """
    Trigger an immediate health check for an endpoint.

    Does not wait for the next scheduled check.
    """
    from app.models.health_check import HealthCheck

    rid = getattr(request.state, "request_id", "unknown")
    repo = EndpointRepository(session)
    endpoint = await repo.get_by_id(endpoint_id)
    if endpoint is None:
        raise NotFoundError("Endpoint", str(endpoint_id))

    # Run the check
    result = await run_check(endpoint)

    # Persist the result
    check = HealthCheck(
        endpoint_id=str(endpoint_id),
        checked_at=datetime.now(UTC),
        status_code=result.status_code,
        latency_ms=result.latency_ms,
        success=result.success,
        failure_reason=result.failure_reason,
        error_detail=result.error_detail,
        worker_id="manual",
        response_body=result.response_body,
        response_headers=result.response_headers,
        content_type=result.content_type,
        response_size_bytes=result.response_size_bytes,
    )
    session.add(check)

    # Update last_checked_at
    endpoint.last_checked_at = datetime.now(UTC)
    await session.flush()

    logger.info(
        "manual_check_completed",
        endpoint_id=str(endpoint_id),
        success=result.success,
        latency_ms=result.latency_ms,
    )

    return DataResponse(data=HealthCheckOut.model_validate(check), request_id=rid)


@router.get("/{endpoint_id}/health", response_model=DataResponse[list[HealthCheckOut]])
async def get_endpoint_health(
    endpoint_id: uuid.UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(50, ge=1, le=500),
) -> DataResponse[list[HealthCheckOut]]:
    """Get recent health check history for an endpoint."""
    rid = getattr(request.state, "request_id", "unknown")
    repo = HealthCheckRepository(session)
    checks = await repo.get_recent(endpoint_id, limit=limit)
    return DataResponse(
        data=[HealthCheckOut.model_validate(c) for c in checks], request_id=rid
    )


@router.get("/{endpoint_id}/incidents", response_model=DataResponse[list])
async def get_endpoint_incidents(
    endpoint_id: uuid.UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(20, ge=1, le=100),
) -> DataResponse[list]:
    """Get incidents associated with an endpoint."""
    from sqlalchemy import select
    from app.models.incident import Incident
    from app.schemas.incident import IncidentSummary

    rid = getattr(request.state, "request_id", "unknown")
    stmt = (
        select(Incident)
        .where(Incident.endpoint_id == str(endpoint_id))
        .order_by(Incident.created_at.desc())
        .limit(limit)
    )
    result = await session.execute(stmt)
    incidents = list(result.scalars().all())
    return DataResponse(
        data=[IncidentSummary.model_validate(i) for i in incidents],
        request_id=rid,
    )


@router.get("/{endpoint_id}/latest-response", response_model=DataResponse)
async def get_endpoint_latest_response(
    endpoint_id: uuid.UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> DataResponse:
    """
    Get the latest health check result including the full response body/headers.

    Returns the most recent health check record for an endpoint.
    Returns null data if no check has been run yet.
    Sensitive headers (Authorization, Cookie, etc.) are never exposed.
    """
    from app.schemas.incident import HealthCheckResponseOut

    rid = getattr(request.state, "request_id", "unknown")
    repo = HealthCheckRepository(session)
    checks = await repo.get_recent(endpoint_id, limit=1)
    if not checks:
        return DataResponse(data=None, request_id=rid)
    return DataResponse(
        data=HealthCheckResponseOut.model_validate(checks[0]),
        request_id=rid,
    )

