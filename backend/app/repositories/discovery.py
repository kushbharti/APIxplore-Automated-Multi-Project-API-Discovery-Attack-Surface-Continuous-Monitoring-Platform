"""
app/repositories/discovery.py
===============================
Data access layer for DiscoveryRun and DiscoveryCandidate.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import DatabaseUnavailableError
from app.models.discovery_candidate import DiscoveryCandidate
from app.models.discovery_run import DiscoveryRun


class DiscoveryRunRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(self, run: DiscoveryRun) -> DiscoveryRun:
        try:
            self._session.add(run)
            await self._session.flush()
            return run
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_by_id(self, run_id: uuid.UUID) -> DiscoveryRun | None:
        try:
            return await self._session.get(DiscoveryRun, run_id)
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_for_project(
        self, project_id: uuid.UUID, limit: int = 20
    ) -> list[DiscoveryRun]:
        try:
            stmt = (
                select(DiscoveryRun)
                .where(DiscoveryRun.project_id == str(project_id))
                .order_by(DiscoveryRun.created_at.desc())
                .limit(limit)
            )
            result = await self._session.execute(stmt)
            return list(result.scalars().all())
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_latest_for_project(self, project_id: uuid.UUID) -> DiscoveryRun | None:
        try:
            stmt = (
                select(DiscoveryRun)
                .where(DiscoveryRun.project_id == str(project_id))
                .order_by(DiscoveryRun.created_at.desc())
                .limit(1)
            )
            result = await self._session.execute(stmt)
            return result.scalar_one_or_none()
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def update(self, run: DiscoveryRun, **kwargs) -> DiscoveryRun:
        for key, val in kwargs.items():
            setattr(run, key, val)
        await self._session.flush()
        return run


class DiscoveryCandidateRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_for_run(
        self,
        run_id: uuid.UUID,
        limit: int = 100,
        offset: int = 0,
        status_filter: str | None = None,
        source_filter: str | None = None,
    ) -> list[DiscoveryCandidate]:
        try:
            stmt = (
                select(DiscoveryCandidate)
                .where(DiscoveryCandidate.run_id == str(run_id))
            )
            if status_filter:
                stmt = stmt.where(DiscoveryCandidate.verification_status == status_filter.upper())
            if source_filter:
                stmt = stmt.where(DiscoveryCandidate.source == source_filter.upper())
            stmt = (
                stmt
                .order_by(DiscoveryCandidate.source, DiscoveryCandidate.path)
                .offset(offset)
                .limit(limit)
            )
            result = await self._session.execute(stmt)
            return list(result.scalars().all())
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def count_for_run(
        self,
        run_id: uuid.UUID,
        status_filter: str | None = None,
    ) -> int:
        try:
            stmt = (
                select(func.count())
                .select_from(DiscoveryCandidate)
                .where(DiscoveryCandidate.run_id == str(run_id))
            )
            if status_filter:
                stmt = stmt.where(DiscoveryCandidate.verification_status == status_filter.upper())
            result = await self._session.execute(stmt)
            return result.scalar() or 0
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_by_id(self, candidate_id: uuid.UUID) -> DiscoveryCandidate | None:
        try:
            return await self._session.get(DiscoveryCandidate, candidate_id)
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_verified_for_run(self, run_id: uuid.UUID) -> list[DiscoveryCandidate]:
        try:
            stmt = (
                select(DiscoveryCandidate)
                .where(
                    DiscoveryCandidate.run_id == str(run_id),
                    DiscoveryCandidate.verification_status == "VERIFIED",
                )
                .order_by(DiscoveryCandidate.created_at)
            )
            result = await self._session.execute(stmt)
            return list(result.scalars().all())
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def mark_accepted(
        self, candidate_id: uuid.UUID, endpoint_id: uuid.UUID
    ) -> None:
        try:
            candidate = await self._session.get(DiscoveryCandidate, candidate_id)
            if candidate:
                candidate.accepted = True
                candidate.endpoint_id = str(endpoint_id)
                await self._session.flush()
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc
