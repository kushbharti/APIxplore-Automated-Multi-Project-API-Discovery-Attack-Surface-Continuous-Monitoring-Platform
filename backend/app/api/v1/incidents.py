"""
app/api/v1/incidents.py
========================
Incident management routes. Authentication removed.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.repositories.incident import IncidentRepository, RecoveryActionRepository, AlertEventRepository
from app.schemas.common import DataResponse
from app.schemas.incident import AlertEventOut, IncidentOut, IncidentSummary, RecoveryActionOut

router = APIRouter(prefix="/incidents", tags=["Incidents"])


@router.get("", response_model=DataResponse[list[IncidentSummary]])
async def list_incidents(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=200),
) -> DataResponse[list[IncidentSummary]]:
    rid = getattr(request.state, "request_id", "unknown")
    repo = IncidentRepository(session)
    incidents = await repo.get_all(status=status_filter, limit=limit)
    return DataResponse(
        data=[IncidentSummary.model_validate(i) for i in incidents], request_id=rid
    )


@router.get("/recovery/history", response_model=DataResponse[list[RecoveryActionOut]], tags=["Recovery"])
async def get_recovery_history(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(50, ge=1, le=200),
) -> DataResponse[list[RecoveryActionOut]]:
    rid = getattr(request.state, "request_id", "unknown")
    repo = RecoveryActionRepository(session)
    actions = await repo.get_all(limit=limit)
    return DataResponse(
        data=[RecoveryActionOut.model_validate(a) for a in actions], request_id=rid
    )


@router.get("/alerts/history", response_model=DataResponse[list[AlertEventOut]], tags=["Alerts"])
async def get_alert_history(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(50, ge=1, le=200),
) -> DataResponse[list[AlertEventOut]]:
    rid = getattr(request.state, "request_id", "unknown")
    repo = AlertEventRepository(session)
    alerts = await repo.get_all(limit=limit)
    return DataResponse(
        data=[AlertEventOut.model_validate(a) for a in alerts], request_id=rid
    )


@router.get("/{incident_id}", response_model=DataResponse[IncidentOut])
async def get_incident(
    incident_id: uuid.UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> DataResponse[IncidentOut]:
    from app.core.exceptions import NotFoundError
    rid = getattr(request.state, "request_id", "unknown")
    repo = IncidentRepository(session)
    incident = await repo.get_by_id(incident_id)
    if incident is None:
        raise NotFoundError("Incident", str(incident_id))
    return DataResponse(data=IncidentOut.model_validate(incident), request_id=rid)


@router.get("/{incident_id}/recovery-actions", response_model=DataResponse[list[RecoveryActionOut]])
async def get_recovery_actions(
    incident_id: uuid.UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> DataResponse[list[RecoveryActionOut]]:
    rid = getattr(request.state, "request_id", "unknown")
    repo = RecoveryActionRepository(session)
    actions = await repo.get_for_incident(incident_id)
    return DataResponse(
        data=[RecoveryActionOut.model_validate(a) for a in actions], request_id=rid
    )
