"""
tests/api/test_endpoints.py
===========================
Tests for endpoint CRUD operations.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.endpoint import Endpoint


@pytest.fixture
async def sample_endpoint(db_session: AsyncSession) -> Endpoint:
    ep = Endpoint(
        name="Test API",
        method="GET",
        url="https://example.com/api",
        expected_status=200,
        timeout_ms=5000,
        check_interval_seconds=30,
        failure_threshold=3,
        latency_threshold_ms=1000,
        enabled=True,
    )
    db_session.add(ep)
    await db_session.commit()
    await db_session.refresh(ep)
    return ep


@pytest.mark.asyncio
async def test_create_endpoint_unauthorized(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/endpoints",
        json={"name": "Test", "method": "GET", "url": "http://test.com"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_create_endpoint_as_admin(admin_client: AsyncClient) -> None:
    payload = {
        "name": "Production API",
        "method": "GET",
        "url": "https://api.prod.com/health",
        "expected_status": 200,
        "timeout_ms": 3000,
        "check_interval_seconds": 60,
        "failure_threshold": 3,
        "latency_threshold_ms": 500,
        "enabled": True,
    }
    response = await admin_client.post("/api/v1/endpoints", json=payload)
    assert response.status_code == 201
    data = response.json()["data"]
    assert data["name"] == "Production API"
    assert data["health_state"] == "UNKNOWN"
    assert "id" in data


@pytest.mark.asyncio
async def test_list_endpoints(
    admin_client: AsyncClient, sample_endpoint: Endpoint
) -> None:
    response = await admin_client.get("/api/v1/endpoints")
    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) >= 1
    assert any(ep["id"] == str(sample_endpoint.id) for ep in data)


@pytest.mark.asyncio
async def test_get_endpoint(
    admin_client: AsyncClient, sample_endpoint: Endpoint
) -> None:
    response = await admin_client.get(f"/api/v1/endpoints/{sample_endpoint.id}")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["id"] == str(sample_endpoint.id)
    assert data["url"] == "https://example.com/api"


@pytest.mark.asyncio
async def test_get_endpoint_not_found(admin_client: AsyncClient) -> None:
    fake_id = uuid.uuid4()
    response = await admin_client.get(f"/api/v1/endpoints/{fake_id}")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_update_endpoint(
    admin_client: AsyncClient, sample_endpoint: Endpoint
) -> None:
    response = await admin_client.patch(
        f"/api/v1/endpoints/{sample_endpoint.id}",
        json={"name": "Updated API", "timeout_ms": 9000},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["name"] == "Updated API"
    assert data["timeout_ms"] == 9000
    assert data["url"] == "https://example.com/api"


@pytest.mark.asyncio
async def test_delete_endpoint(
    admin_client: AsyncClient, sample_endpoint: Endpoint
) -> None:
    response = await admin_client.delete(f"/api/v1/endpoints/{sample_endpoint.id}")
    assert response.status_code == 204

    # Verify deleted
    get_resp = await admin_client.get(f"/api/v1/endpoints/{sample_endpoint.id}")
    assert get_resp.status_code == 404
