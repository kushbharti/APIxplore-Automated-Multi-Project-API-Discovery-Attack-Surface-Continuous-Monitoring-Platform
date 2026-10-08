"""
app/repositories/endpoint.py
==============================
Data access layer for Endpoint and HealthCheck entities.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import structlog
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, OperationalError, TimeoutError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ConflictError,
    DatabaseQueryError,
    DatabaseTimeoutError,
    DatabaseUnavailableError,
    NotFoundError,
)
from app.models.endpoint import Endpoint
from app.models.health_check import HealthCheck

logger = structlog.get_logger(__name__)


class EndpointRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(self, endpoint: Endpoint) -> Endpoint:
        try:
            self._session.add(endpoint)
            await self._session.flush()
            return endpoint
        except IntegrityError as exc:
            await self._session.rollback()
            raise ConflictError("An endpoint with this name already exists.") from exc
        except TimeoutError as exc:
            raise DatabaseTimeoutError() from exc
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_by_id(self, endpoint_id: uuid.UUID) -> Endpoint | None:
        try:
            return await self._session.get(Endpoint, endpoint_id)
        except TimeoutError as exc:
            raise DatabaseTimeoutError() from exc
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_all(
        self,
        enabled_only: bool = False,
        project_id: str | None = None,
        health_state: str | None = None,
    ) -> list[Endpoint]:
        try:
            stmt = select(Endpoint).order_by(Endpoint.created_at.desc())
            if enabled_only:
                stmt = stmt.where(Endpoint.enabled.is_(True))
            if project_id is not None:
                stmt = stmt.where(Endpoint.project_id == str(project_id))
            if health_state is not None:
                stmt = stmt.where(Endpoint.health_state == health_state)
            result = await self._session.execute(stmt)
            return list(result.scalars().all())
        except TimeoutError as exc:
            raise DatabaseTimeoutError() from exc
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def update(self, endpoint: Endpoint, updates: dict) -> Endpoint:
        try:
            for key, value in updates.items():
                if hasattr(endpoint, key) and value is not None:
                    setattr(endpoint, key, value)
            await self._session.flush()
            return endpoint
        except TimeoutError as exc:
            raise DatabaseTimeoutError() from exc
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def delete(self, endpoint: Endpoint) -> None:
        try:
            await self._session.delete(endpoint)
            await self._session.flush()
        except TimeoutError as exc:
            raise DatabaseTimeoutError() from exc
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def update_health_state(
        self, endpoint_id: uuid.UUID, state: str, last_checked_at=None
    ) -> None:
        """Update health_state and optionally last_checked_at."""
        from datetime import UTC, datetime
        try:
            endpoint = await self._session.get(Endpoint, endpoint_id)
            if endpoint:
                endpoint.health_state = state
                endpoint.last_checked_at = last_checked_at or datetime.now(UTC)
                await self._session.flush()
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_due_for_check(self) -> list[Endpoint]:
        """Return enabled endpoints whose next check is overdue."""
        try:
            stmt = select(Endpoint).where(Endpoint.enabled.is_(True))
            result = await self._session.execute(stmt)
            endpoints = list(result.scalars().all())

            due = []
            now = datetime.now(UTC)
            for ep in endpoints:
                if not ep.last_checked_at:
                    due.append(ep)
                else:
                    # Ensure last_checked_at is timezone-aware for comparison
                    last_checked = ep.last_checked_at
                    if last_checked.tzinfo is None:
                        last_checked = last_checked.replace(tzinfo=UTC)
                    elapsed = (now - last_checked).total_seconds()
                    if elapsed >= ep.check_interval_seconds:
                        due.append(ep)
            return due
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc


class HealthCheckRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(self, check: HealthCheck) -> HealthCheck:
        try:
            self._session.add(check)
            await self._session.flush()
            return check
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_recent(
        self, endpoint_id: uuid.UUID, limit: int = 20
    ) -> list[HealthCheck]:
        """Return the N most recent health checks for an endpoint."""
        try:
            stmt = (
                select(HealthCheck)
                .where(HealthCheck.endpoint_id == str(endpoint_id))
                .order_by(HealthCheck.checked_at.desc())
                .limit(limit)
            )
            result = await self._session.execute(stmt)
            return list(result.scalars().all())
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_window(
        self, endpoint_id: uuid.UUID, window_seconds: int = 300
    ) -> list[HealthCheck]:
        """Return checks within the last N seconds for rolling window analysis."""
        try:
            cutoff = datetime.now(UTC) - timedelta(seconds=window_seconds)
            stmt = (
                select(HealthCheck)
                .where(
                    HealthCheck.endpoint_id == str(endpoint_id),
                    HealthCheck.checked_at >= cutoff,
                )
                .order_by(HealthCheck.checked_at.desc())
            )
            result = await self._session.execute(stmt)
            return list(result.scalars().all())
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def count_recent_failures(
        self, endpoint_id: uuid.UUID, window_seconds: int = 300
    ) -> int:
        """Count failures in the rolling window."""
        try:
            cutoff = datetime.now(UTC) - timedelta(seconds=window_seconds)
            stmt = select(func.count()).select_from(HealthCheck).where(
                HealthCheck.endpoint_id == str(endpoint_id),
                HealthCheck.checked_at >= cutoff,
                HealthCheck.success.is_(False),
            )
            result = await self._session.execute(stmt)
            return result.scalar_one()
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc
