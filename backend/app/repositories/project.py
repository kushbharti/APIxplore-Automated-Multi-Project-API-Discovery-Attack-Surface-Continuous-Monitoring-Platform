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

    async def get_by_id(self, project_id: uuid.UUID | str) -> Project | None:
        try:
            project = await self._session.get(Project, str(project_id))
            if project:
                await self.sync_project_counts([project])
            return project
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_by_url(self, url: str) -> Project | None:
        try:
            result = await self._session.execute(select(Project).where(Project.url == url))
            project = result.scalar_one_or_none()
            if project:
                await self.sync_project_counts([project])
            return project
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def get_all(self, limit: int = 100) -> list[Project]:
        try:
            stmt = select(Project).order_by(Project.created_at.desc()).limit(limit)
            result = await self._session.execute(stmt)
            projects = list(result.scalars().all())
            await self.sync_project_counts(projects)
            return projects
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def sync_project_counts(self, projects: list[Project] | Project | uuid.UUID | str) -> None:
        """
        Calculate actual endpoint counts from the endpoints table scoped to each project,
        populating endpoint_count, healthy_count, degraded_count, down_count, unknown_count,
        status, and health_score accurately without fabricated numbers.
        """
        if not projects:
            return

        from app.models.project import Project
        from app.models.endpoint import Endpoint

        if isinstance(projects, (uuid.UUID, str)):
            pid = str(projects)
            single_proj = await self.get_by_id(pid)
            if not single_proj:
                return
            projects = [single_proj]
        elif isinstance(projects, Project):
            projects = [projects]

        proj_id_map: dict[str, Project] = {}
        for p in projects:
            proj_id_map[str(p.id)] = p
            proj_id_map[str(p.id).replace("-", "")] = p

        stmt = (
            select(
                Endpoint.project_id,
                Endpoint.health_state,
                func.count(Endpoint.id)
            )
            .where(Endpoint.project_id.in_(list(proj_id_map.keys())))
            .group_by(Endpoint.project_id, Endpoint.health_state)
        )
        try:
            result = await self._session.execute(stmt)
            rows = result.all()

            stats_by_pid: dict[str, dict[str, int]] = {
                str(p.id): {"HEALTHY": 0, "DEGRADED": 0, "DOWN": 0, "UNKNOWN": 0, "TOTAL": 0}
                for p in projects
            }

            for pid_str, health_state, cnt in rows:
                p_match = proj_id_map.get(pid_str)
                if p_match:
                    canon_id = str(p_match.id)
                    hs = (health_state or "UNKNOWN").upper()
                    if hs in ("DEGRADED", "RECOVERING"):
                        stats_by_pid[canon_id]["DEGRADED"] += cnt
                    elif hs == "HEALTHY":
                        stats_by_pid[canon_id]["HEALTHY"] += cnt
                    elif hs == "DOWN":
                        stats_by_pid[canon_id]["DOWN"] += cnt
                    else:
                        stats_by_pid[canon_id]["UNKNOWN"] += cnt
                    stats_by_pid[canon_id]["TOTAL"] += cnt

            for p in projects:
                canon_id = str(p.id)
                s = stats_by_pid.get(canon_id, {"HEALTHY": 0, "DEGRADED": 0, "DOWN": 0, "UNKNOWN": 0, "TOTAL": 0})
                p.endpoint_count = s["TOTAL"]
                p.healthy_count = s["HEALTHY"]
                p.degraded_count = s["DEGRADED"]
                p.down_count = s["DOWN"]
                setattr(p, "unknown_count", s["UNKNOWN"])

                if s["TOTAL"] == 0:
                    p.status = "UNKNOWN"
                    p.health_score = None
                else:
                    if s["DOWN"] > 0:
                        p.status = "DOWN"
                    elif s["DEGRADED"] > 0:
                        p.status = "DEGRADED"
                    elif s["HEALTHY"] > 0:
                        p.status = "HEALTHY"
                    else:
                        p.status = "UNKNOWN"

                    p.health_score = round(
                        ((s["HEALTHY"] * 100.0) + (s["DEGRADED"] * 50.0)) / s["TOTAL"],
                        1
                    )
        except Exception as exc:
            logger.warning("sync_project_counts_failed", error=str(exc))

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
        project_id: uuid.UUID | str,
        endpoint_count: int,
        healthy: int,
        degraded: int,
        down: int,
        health_score: float | None,
        status: str,
    ) -> None:
        """Update project dashboard counters (called by monitoring worker)."""
        try:
            project = await self._session.get(Project, str(project_id))
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
