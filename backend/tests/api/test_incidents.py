"""
tests/api/test_incidents.py
===========================
Tests for incidents API.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.incident import Incident, IncidentStatus


@pytest.fixture
async def sample_incident(db_session: AsyncSession) -> Incident:
    incident = Incident(
        endpoint_id=str(uuid.uuid4()),
        title="Test Incident",
        failure_type="APPLICATION_FAILURE",
        severity="HIGH",
        status=IncidentStatus.DETECTED.value,
        failure_count=1,
        recovery_attempts=0,
        detected_at=datetime.now(UTC),
    )
    db_session.add(incident)
    await db_session.commit()
    await db_session.refresh(incident)
    return incident


@pytest.mark.asyncio
async def test_list_incidents(
    user_client: AsyncClient, sample_incident: Incident
) -> None:
    response = await user_client.get("/api/v1/incidents")
    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) >= 1
    assert any(i["id"] == str(sample_incident.id) for i in data)


@pytest.mark.asyncio
async def test_get_incident(
    user_client: AsyncClient, sample_incident: Incident
) -> None:
    response = await user_client.get(f"/api/v1/incidents/{sample_incident.id}")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["id"] == str(sample_incident.id)
    assert data["title"] == "Test Incident"


@pytest.mark.asyncio
async def test_get_incident_not_found(user_client: AsyncClient) -> None:
    fake_id = uuid.uuid4()
    response = await user_client.get(f"/api/v1/incidents/{fake_id}")
    assert response.status_code == 404
