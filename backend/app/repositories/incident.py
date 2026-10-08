"""
app/repositories/incident.py
=============================
Data access for Incident, RecoveryAction, and AlertEvent.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import structlog
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import DatabaseUnavailableError
from app.models.alert_event import AlertEvent
from app.models.incident import Incident, IncidentStatus
from app.models.recovery_action import RecoveryAction

logger = structlog.get_logger(__name__)


class IncidentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(self, incident: Incident) -> Incident:
        try:
            self._session.add(incident)
            await self._session.flush()
            return incident
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_by_id(self, incident_id: uuid.UUID) -> Incident | None:
        try:
            return await self._session.get(Incident, incident_id)
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_active_for_endpoint(self, endpoint_id: uuid.UUID) -> Incident | None:
        """Return the active (non-resolved) incident for an endpoint, if any."""
        try:
            stmt = select(Incident).where(
                Incident.endpoint_id == str(endpoint_id),
                Incident.status.notin_([
                    IncidentStatus.RESOLVED.value,
                    IncidentStatus.ESCALATED.value,
                ]),
            ).order_by(Incident.created_at.desc()).limit(1)
            result = await self._session.execute(stmt)
            return result.scalar_one_or_none()
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_all(self, status: str | None = None, limit: int = 100) -> list[Incident]:
        try:
            stmt = select(Incident).order_by(Incident.created_at.desc()).limit(limit)
            if status:
                stmt = stmt.where(Incident.status == status)
            result = await self._session.execute(stmt)
            return list(result.scalars().all())
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def update_status(self, incident: Incident, status: str) -> Incident:
        try:
            incident.status = status
            if status == IncidentStatus.RESOLVED.value and not incident.resolved_at:
                incident.resolved_at = datetime.now(UTC)
            await self._session.flush()
            return incident
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def increment_failures(self, incident: Incident) -> Incident:
        incident.failure_count += 1
        await self._session.flush()
        return incident

    async def update(self, incident: Incident, **kwargs) -> Incident:
        for key, val in kwargs.items():
            setattr(incident, key, val)
        await self._session.flush()
        return incident


class RecoveryActionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(self, action: RecoveryAction) -> RecoveryAction:
        try:
            self._session.add(action)
            await self._session.flush()
            return action
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_for_incident(self, incident_id: uuid.UUID) -> list[RecoveryAction]:
        try:
            stmt = (
                select(RecoveryAction)
                .where(RecoveryAction.incident_id == str(incident_id))
                .order_by(RecoveryAction.started_at)
            )
            result = await self._session.execute(stmt)
            return list(result.scalars().all())
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_all(self, limit: int = 100) -> list[RecoveryAction]:
        try:
            stmt = select(RecoveryAction).order_by(RecoveryAction.started_at.desc()).limit(limit)
            result = await self._session.execute(stmt)
            return list(result.scalars().all())
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc


class AlertEventRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(self, alert: AlertEvent) -> AlertEvent:
        try:
            self._session.add(alert)
            await self._session.flush()
            return alert
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_all(self, limit: int = 100) -> list[AlertEvent]:
        try:
            stmt = select(AlertEvent).order_by(AlertEvent.created_at.desc()).limit(limit)
            result = await self._session.execute(stmt)
            return list(result.scalars().all())
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_recent_by_dedup_key(
        self, dedup_key: str, within_seconds: int = 3600
    ) -> AlertEvent | None:
        """Check if a duplicate alert was recently fired (for cooldown)."""
        try:
            from datetime import timedelta
            cutoff = datetime.now(UTC) - timedelta(seconds=within_seconds)
            stmt = (
                select(AlertEvent)
                .where(
                    AlertEvent.dedup_key == dedup_key,
                    AlertEvent.created_at >= cutoff,
                )
                .order_by(AlertEvent.created_at.desc())
                .limit(1)
            )
            result = await self._session.execute(stmt)
            return result.scalar_one_or_none()
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc
