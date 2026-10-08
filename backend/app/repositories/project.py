"""
app/repositories/project.py
============================
Data access layer for Project entities.
"""

from __future__ import annotations

import uuid

import structlog
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, DatabaseUnavailableError
from app.models.project import Project

logger = structlog.get_logger(__name__)


class ProjectRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(self, project: Project) -> Project:
        try:
            self._session.add(project)
            await self._session.flush()
            return project
        except IntegrityError as exc:
            await self._session.rollback()
            raise ConflictError("A project with this name already exists.") from exc
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_by_id(self, project_id: uuid.UUID) -> Project | None:
        try:
            return await self._session.get(Project, project_id)
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_by_url(self, url: str) -> Project | None:
        try:
            result = await self._session.execute(select(Project).where(Project.url == url))
            return result.scalar_one_or_none()
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_all(self, limit: int = 100) -> list[Project]:
        try:
            stmt = select(Project).order_by(Project.created_at.desc()).limit(limit)
            result = await self._session.execute(stmt)
            return list(result.scalars().all())
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def update(self, project: Project, updates: dict) -> Project:
        try:
            for key, value in updates.items():
                if hasattr(project, key) and value is not None:
                    setattr(project, key, value)
            await self._session.flush()
            return project
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def delete(self, project: Project) -> None:
        try:
            await self._session.delete(project)
            await self._session.flush()
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def count(self) -> int:
        try:
            result = await self._session.execute(select(func.count()).select_from(Project))
            return result.scalar_one()
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def update_stats(
        self,
        project_id: uuid.UUID,
        endpoint_count: int,
        healthy: int,
        degraded: int,
        down: int,
        health_score: float | None,
        status: str,
    ) -> None:
        """Update project dashboard counters (called by monitoring worker)."""
        try:
            project = await self._session.get(Project, project_id)
            if project:
                project.endpoint_count = endpoint_count
                project.healthy_count = healthy
                project.degraded_count = degraded
                project.down_count = down
                project.health_score = health_score
                project.status = status
                await self._session.flush()
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc
