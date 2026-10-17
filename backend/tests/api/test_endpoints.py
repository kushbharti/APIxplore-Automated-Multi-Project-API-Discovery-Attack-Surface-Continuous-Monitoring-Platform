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
async def test_create_endpoint_ssrf_blocked(client: AsyncClient) -> None:
    """Outbound request to loopback/private IP should be blocked by SSRF check."""
    response = await client.post(
        "/api/v1/endpoints",
        json={"name": "SSRF Test", "method": "GET", "url": "http://127.0.0.1:8000/internal"},
    )
    assert response.status_code in (400, 422)


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


@pytest.mark.asyncio
async def test_get_endpoint_schema(
    admin_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Test schema extraction for an endpoint with path params."""
    ep = Endpoint(
        name="Param Endpoint",
        method="POST",
        url="https://api.example.com/v1/users/{user_id}/items",
        path="/v1/users/{user_id}/items",
        expected_status=200,
        timeout_ms=5000,
        check_interval_seconds=60,
        failure_threshold=3,
        latency_threshold_ms=1000,
        enabled=True,
    )
    db_session.add(ep)
    await db_session.commit()
    await db_session.refresh(ep)

    resp = await admin_client.get(f"/api/v1/endpoints/{ep.id}/schema")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["endpoint_id"] == str(ep.id)
    assert data["method"] == "POST"
    assert len(data["path_parameters"]) == 1
    assert data["path_parameters"][0]["name"] == "user_id"
    assert data["path_parameters"][0]["required"] is True
    assert data["request_body"] is not None
    assert data["request_body"]["content_type"] == "application/json"


@pytest.mark.asyncio
async def test_check_endpoint_now_with_custom_request(
    admin_client: AsyncClient, sample_endpoint: Endpoint
) -> None:
    """Test check execution endpoint accepting custom path_params, headers, and body."""
    payload = {
        "headers": {"X-Custom-Test": "1"},
        "query_params": {"q": "search"},
        "body": {"name": "sample"},
    }
    resp = await admin_client.post(f"/api/v1/endpoints/{sample_endpoint.id}/check", json=payload)
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "status_code" in data
    assert "latency_ms" in data
    assert "success" in data


@pytest.mark.asyncio
async def test_remove_from_monitoring_preserves_discovery_candidate(
    admin_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Removing an endpoint from monitoring must preserve the discovery candidate history while unlinking it."""
    from app.models.project import Project
    from app.models.discovery_run import DiscoveryRun
    from app.models.discovery_candidate import DiscoveryCandidate

    project = Project(name="Project X", url="https://example.com")
    db_session.add(project)
    await db_session.flush()

    run = DiscoveryRun(project_id=str(project.id), status="COMPLETED")
    db_session.add(run)
    await db_session.flush()

    ep = Endpoint(
        name="Candidate Monitored",
        method="GET",
        url="https://example.com/api/test",
        path="/api/test",
        project_id=str(project.id),
        expected_status=200,
        timeout_ms=5000,
        check_interval_seconds=60,
        failure_threshold=3,
        latency_threshold_ms=1000,
        enabled=True,
    )
    db_session.add(ep)
    await db_session.flush()

    candidate = DiscoveryCandidate(
        run_id=str(run.id),
        project_id=str(project.id),
        method="GET",
        path="/api/test",
        full_url="https://example.com/api/test",
        accepted=True,
        endpoint_id=str(ep.id),
    )
    db_session.add(candidate)
    await db_session.commit()

    # Call DELETE to remove from monitoring
    del_resp = await admin_client.delete(f"/api/v1/endpoints/{ep.id}")
    assert del_resp.status_code == 204

    # The Endpoint is gone
    get_ep = await admin_client.get(f"/api/v1/endpoints/{ep.id}")
    assert get_ep.status_code == 404

    # But DiscoveryCandidate is still in the database with discovery history intact!
    await db_session.refresh(candidate)
    assert candidate.accepted is False
    assert candidate.endpoint_id is None
    assert candidate.path == "/api/test"


async def test_nested_body_schema_extraction(admin_client: AsyncClient, db_session: AsyncSession) -> None:
    from app.services.endpoint_schema import _extract_body_field

    raw_prop = {
        "type": "object",
        "description": "User profile with nested address and tags",
        "properties": {
            "username": {"type": "string", "description": "Login username"},
            "address": {
                "type": "object",
                "properties": {
                    "city": {"type": "string"},
                    "zip": {"type": "integer"},
                },
                "required": ["city"],
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
            },
            "status": {
                "type": "string",
                "enum": ["active", "suspended", "pending"],
            },
        },
        "required": ["username", "status"],
    }

    field = _extract_body_field("user", raw_prop, required=True, spec={})
    assert field.name == "user"
    assert field.type == "object"
    assert field.required is True
    assert len(field.fields) == 4

    field_map = {f.name: f for f in field.fields}
    assert field_map["username"].required is True
    assert field_map["address"].type == "object"
    assert len(field_map["address"].fields) == 2
    assert field_map["tags"].type == "array"
    assert field_map["tags"].item_type == "string"
    assert field_map["status"].enum == ["active", "suspended", "pending"]


