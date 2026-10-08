"""
app/api/v1/analytics.py
========================
Analytics routes — aggregated metrics and trend data.

All queries are read-only against the health_checks, endpoints,
incidents, and projects tables.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.endpoint import Endpoint, HealthState
from app.models.health_check import HealthCheck
from app.models.incident import Incident, IncidentStatus
from app.models.project import Project
from app.schemas.common import DataResponse
from app.schemas.project import EndpointAnalytics, OverviewStats

router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get("/overview", response_model=DataResponse[OverviewStats])
async def get_overview(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> DataResponse[OverviewStats]:
    """Platform-wide KPI dashboard overview."""
    rid = getattr(request.state, "request_id", "unknown")
    cutoff_24h = datetime.now(UTC) - timedelta(hours=24)

    # Project count
    total_projects = await session.scalar(select(func.count()).select_from(Project)) or 0

    # Endpoint counts
    total_endpoints = await session.scalar(select(func.count()).select_from(Endpoint)) or 0
    enabled_endpoints = await session.scalar(
        select(func.count()).select_from(Endpoint).where(Endpoint.enabled.is_(True))
    ) or 0

    # Health state breakdown
    async def count_state(state: str) -> int:
        return await session.scalar(
            select(func.count()).select_from(Endpoint).where(Endpoint.health_state == state)
        ) or 0

    healthy = await count_state(HealthState.HEALTHY.value)
    degraded = await count_state(HealthState.DEGRADED.value)
    down = await count_state(HealthState.DOWN.value)
    unknown = await count_state(HealthState.UNKNOWN.value)

    # Active incidents
    active_incidents = await session.scalar(
        select(func.count()).select_from(Incident).where(
            Incident.status.notin_([
                IncidentStatus.RESOLVED.value,
                IncidentStatus.ESCALATED.value,
            ])
        )
    ) or 0

    # 24h check stats
    total_checks = await session.scalar(
        select(func.count()).select_from(HealthCheck).where(
            HealthCheck.checked_at >= cutoff_24h
        )
    ) or 0

    success_checks = await session.scalar(
        select(func.count()).select_from(HealthCheck).where(
            HealthCheck.checked_at >= cutoff_24h,
            HealthCheck.success.is_(True),
        )
    ) or 0

    avg_latency = await session.scalar(
        select(func.avg(HealthCheck.latency_ms)).where(
            HealthCheck.checked_at >= cutoff_24h,
            HealthCheck.latency_ms.is_not(None),
        )
    )

    success_rate = (success_checks / total_checks) if total_checks > 0 else None

    return DataResponse(
        data=OverviewStats(
            total_projects=total_projects,
            total_endpoints=total_endpoints,
            enabled_endpoints=enabled_endpoints,
            healthy_endpoints=healthy,
            degraded_endpoints=degraded,
            down_endpoints=down,
            unknown_endpoints=unknown,
            active_incidents=active_incidents,
            total_checks_24h=total_checks,
            success_rate_24h=round(success_rate, 4) if success_rate is not None else None,
            avg_latency_24h=round(float(avg_latency), 1) if avg_latency is not None else None,
        ),
        request_id=rid,
    )


@router.get("/endpoints/{endpoint_id}", response_model=DataResponse[EndpointAnalytics])
async def get_endpoint_analytics(
    endpoint_id: uuid.UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
    hours: int = Query(24, ge=1, le=168),
) -> DataResponse[EndpointAnalytics]:
    """Analytics for a specific endpoint."""
    from app.core.exceptions import NotFoundError

    rid = getattr(request.state, "request_id", "unknown")
    endpoint = await session.get(Endpoint, endpoint_id)
    if endpoint is None:
        raise NotFoundError("Endpoint", str(endpoint_id))

    cutoff = datetime.now(UTC) - timedelta(hours=hours)

    checks = await session.execute(
        select(HealthCheck.success, HealthCheck.latency_ms).where(
            HealthCheck.endpoint_id == str(endpoint_id),
            HealthCheck.checked_at >= cutoff,
        )
    )
    rows = checks.all()

    checks_count = len(rows)
    successes = sum(1 for r in rows if r.success)
    latencies = [r.latency_ms for r in rows if r.latency_ms is not None]

    success_rate = (successes / checks_count) if checks_count > 0 else None
    avg_latency = sum(latencies) / len(latencies) if latencies else None
    p95_latency = None
    if len(latencies) >= 5:
        sorted_lat = sorted(latencies)
        p95_latency = sorted_lat[int(len(sorted_lat) * 0.95)]

    error_rate = 1 - success_rate if success_rate is not None else None

    return DataResponse(
        data=EndpointAnalytics(
            endpoint_id=endpoint_id,
            name=endpoint.name,
            url=endpoint.url,
            checks_24h=checks_count,
            success_rate=round(success_rate, 4) if success_rate is not None else None,
            avg_latency_ms=round(avg_latency, 1) if avg_latency is not None else None,
            p95_latency_ms=round(p95_latency, 1) if p95_latency is not None else None,
            error_rate=round(error_rate, 4) if error_rate is not None else None,
            downtime_minutes=None,  # TODO: calculate from incidents
        ),
        request_id=rid,
    )


@router.get("/history/{endpoint_id}", response_model=DataResponse[list[dict]])
async def get_endpoint_history(
    endpoint_id: uuid.UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
    hours: int = Query(24, ge=1, le=168),
    limit: int = Query(500, ge=1, le=2000),
) -> DataResponse[list[dict]]:
    """Get time-series health check data for charting."""
    from app.core.exceptions import NotFoundError

    rid = getattr(request.state, "request_id", "unknown")
    endpoint = await session.get(Endpoint, endpoint_id)
    if endpoint is None:
        raise NotFoundError("Endpoint", str(endpoint_id))

    cutoff = datetime.now(UTC) - timedelta(hours=hours)
    stmt = (
        select(HealthCheck)
        .where(
            HealthCheck.endpoint_id == str(endpoint_id),
            HealthCheck.checked_at >= cutoff,
        )
        .order_by(HealthCheck.checked_at.asc())
        .limit(limit)
    )
    result = await session.execute(stmt)
    checks = result.scalars().all()

    return DataResponse(
        data=[
            {
                "timestamp": c.checked_at.isoformat(),
                "success": c.success,
                "latency_ms": c.latency_ms,
                "status_code": c.status_code,
                "failure_reason": c.failure_reason,
            }
            for c in checks
        ],
        request_id=rid,
    )
