"""
app/services/endpoint.py
=========================
Business logic for endpoint management.
"""

from __future__ import annotations

import uuid

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.endpoint import Endpoint
from app.repositories.endpoint import EndpointRepository
from app.schemas.endpoint import EndpointCreate, EndpointOut, EndpointSummary, EndpointUpdate

logger = structlog.get_logger(__name__)


class EndpointService:
    def __init__(self, session: AsyncSession) -> None:
        self._repo = EndpointRepository(session)

    async def create(self, data: EndpointCreate) -> EndpointOut:
        endpoint = Endpoint(
            name=data.name,
            description=data.description,
            method=data.method,
            url=str(data.url),
            expected_status=data.expected_status,
            timeout_ms=data.timeout_ms,
            check_interval_seconds=data.check_interval_seconds,
            failure_threshold=data.failure_threshold,
            latency_threshold_ms=data.latency_threshold_ms,
            enabled=data.enabled,
            tags=data.tags,
            project_id=str(data.project_id) if data.project_id else None,
        )
        created = await self._repo.create(endpoint)
        logger.info("endpoint_created", endpoint_id=str(created.id), name=created.name)
        return EndpointOut.model_validate(created)

    async def list_all(
        self,
        enabled_only: bool = False,
        project_id: uuid.UUID | None = None,
        health_state: str | None = None,
    ) -> list[EndpointSummary]:
        endpoints = await self._repo.get_all(
            enabled_only=enabled_only,
            project_id=project_id,
            health_state=health_state,
        )
        return [EndpointSummary.model_validate(e) for e in endpoints]

    async def get(self, endpoint_id: uuid.UUID) -> EndpointOut:
        endpoint = await self._repo.get_by_id(endpoint_id)
        if endpoint is None:
            raise NotFoundError("Endpoint", str(endpoint_id))
        return EndpointOut.model_validate(endpoint)

    async def update(self, endpoint_id: uuid.UUID, data: EndpointUpdate) -> EndpointOut:
        endpoint = await self._repo.get_by_id(endpoint_id)
        if endpoint is None:
            raise NotFoundError("Endpoint", str(endpoint_id))
        updates = data.model_dump(exclude_none=True)
        updated = await self._repo.update(endpoint, updates)
        logger.info("endpoint_updated", endpoint_id=str(endpoint_id))
        return EndpointOut.model_validate(updated)

    async def delete(self, endpoint_id: uuid.UUID) -> None:
        endpoint = await self._repo.get_by_id(endpoint_id)
        if endpoint is None:
            raise NotFoundError("Endpoint", str(endpoint_id))
        await self._repo.delete(endpoint)
        logger.info("endpoint_deleted", endpoint_id=str(endpoint_id))

    async def toggle_enabled(self, endpoint_id: uuid.UUID, enabled: bool) -> EndpointOut:
        endpoint = await self._repo.get_by_id(endpoint_id)
        if endpoint is None:
            raise NotFoundError("Endpoint", str(endpoint_id))
        endpoint.enabled = enabled
        await self._repo.update(endpoint, {})
        return EndpointOut.model_validate(endpoint)
