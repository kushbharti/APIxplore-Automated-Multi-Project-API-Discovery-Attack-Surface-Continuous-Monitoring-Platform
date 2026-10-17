"""
tests/api/test_projects.py
==========================
Tests for project management, exact URL preservation, and live endpoint count synchronization.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.endpoint import Endpoint
from app.models.project import Project


@pytest.mark.asyncio
async def test_create_project_exact_url_preservation(client: AsyncClient) -> None:
    """Verifies that user-entered target URLs retain paths, trailing slashes, and query params."""
    target_url = "https://httpbin.org/api/v2/test/?filter=all"
    payload = {
        "name": "Exact URL Test Project",
        "description": "Verifying URL integrity without truncation",
        "url": target_url,
        "source_type": "WEBSITE",
    }
    response = await client.post("/api/v1/projects", json=payload)
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["url"] == target_url, f"Expected {target_url}, got {data['url']}"
    assert data["endpoint_count"] == 0
    assert data["healthy_count"] == 0
    assert data["unknown_count"] == 0


@pytest.mark.asyncio
async def test_project_endpoint_counts_synchronization(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Verifies that ProjectRepository.sync_project_counts accurately computes health states."""
    # 1. Create a project
    create_resp = await client.post(
        "/api/v1/projects",
        json={
            "name": "Sync Metrics Project",
            "url": "https://example.com/api/",
            "source_type": "WEBSITE",
        },
    )
    assert create_resp.status_code == 201
    proj_id = create_resp.json()["data"]["id"]

    # 2. Add endpoints in different health states
    ep1 = Endpoint(
        name="Healthy EP",
        project_id=proj_id,
        method="GET",
        url="https://example.com/api/users",
        health_state="HEALTHY",
        enabled=True,
    )
    ep2 = Endpoint(
        name="Degraded EP",
        project_id=proj_id,
        method="GET",
        url="https://example.com/api/orders",
        health_state="DEGRADED",
        enabled=True,
    )
    ep3 = Endpoint(
        name="Down EP",
        project_id=proj_id,
        method="GET",
        url="https://example.com/api/billing",
        health_state="DOWN",
        enabled=True,
    )
    ep4 = Endpoint(
        name="Unknown EP",
        project_id=proj_id,
        method="GET",
        url="https://example.com/api/reports",
        health_state="UNKNOWN",
        enabled=True,
    )
    db_session.add_all([ep1, ep2, ep3, ep4])
    await db_session.commit()

    # 3. Fetch project by ID and verify live counts
    get_resp = await client.get(f"/api/v1/projects/{proj_id}")
    assert get_resp.status_code == 200
    pdata = get_resp.json()["data"]
    assert pdata["endpoint_count"] == 4
    assert pdata["healthy_count"] == 1
    assert pdata["degraded_count"] == 1
    assert pdata["down_count"] == 1
    assert pdata["unknown_count"] == 1

    # 4. Verify in list projects
    list_resp = await client.get("/api/v1/projects")
    assert list_resp.status_code == 200
    all_projects = list_resp.json()["data"]
    match = next((p for p in all_projects if p["id"] == proj_id), None)
    assert match is not None
    assert match["endpoint_count"] == 4
    assert match["healthy_count"] == 1
    assert match["degraded_count"] == 1
    assert match["down_count"] == 1
    assert match["unknown_count"] == 1


@pytest.mark.asyncio
async def test_project_source_types_and_url_validation(client: AsyncClient) -> None:
    """Verifies that WEBSITE and API projects can be registered with valid URLs."""
    # 1. Valid Website project URL
    web_resp = await client.post(
        "/api/v1/projects",
        json={
            "name": "Production Web App",
            "url": "https://example.com",
            "source_type": "WEBSITE",
        },
    )
    assert web_resp.status_code == 201
    assert web_resp.json()["data"]["source_type"] == "WEBSITE"

    # 2. Valid API project URL
    api_resp = await client.post(
        "/api/v1/projects",
        json={
            "name": "Public API Gateway",
            "url": "https://example.com/api",
            "source_type": "API",
        },
    )
    assert api_resp.status_code == 201
    assert api_resp.json()["data"]["source_type"] == "API"

    # 3. Invalid URL scheme rejected
    bad_resp = await client.post(
        "/api/v1/projects",
        json={
            "name": "Invalid Protocol",
            "url": "ftp://example.com",
            "source_type": "WEBSITE",
        },
    )
    assert bad_resp.status_code in (400, 422)


@pytest.mark.asyncio
async def test_accept_candidates_adds_to_monitoring_and_prevents_duplicates(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Verifies accepting candidates persists endpoints and rejects duplicate registrations."""
    import uuid
    from app.models.discovery_candidate import DiscoveryCandidate
    from app.models.discovery_run import DiscoveryRun, DiscoveryStatus

    # 1. Create project
    proj_resp = await client.post(
        "/api/v1/projects",
        json={"name": "Candidate Test Project", "url": "https://api.testservice.com/v1", "source_type": "WEBSITE"},
    )
    assert proj_resp.status_code == 201
    proj_id = proj_resp.json()["data"]["id"]

    # 2. Create DiscoveryRun
    run = DiscoveryRun(
        project_id=proj_id,
        status=DiscoveryStatus.COMPLETED.value,
    )
    db_session.add(run)
    await db_session.flush()

    # 3. Create candidates
    c1 = DiscoveryCandidate(
        run_id=str(run.id),
        project_id=str(proj_id),
        method="GET",
        path="/v1/users",
        full_url="https://api.testservice.com/v1/users",
        source="OPENAPI",
        confidence="HIGH",
        verification_status="VERIFIED",
    )
    c2 = DiscoveryCandidate(
        run_id=str(run.id),
        project_id=str(proj_id),
        method="POST",
        path="/v1/users",
        full_url="https://api.testservice.com/v1/users",
        source="OPENAPI",
        confidence="HIGH",
        verification_status="VERIFIED",
    )
    db_session.add_all([c1, c2])
    await db_session.commit()

    # 4. Accept candidates
    accept_resp = await client.post(
        f"/api/v1/discovery/{run.id}/accept",
        json={"candidate_ids": [str(c1.id), str(c2.id)]},
    )
    assert accept_resp.status_code == 200
    adata = accept_resp.json()["data"]
    assert adata["created"] == 2
    assert adata["skipped"] == 0

    # 5. Verify endpoints appear in GET /endpoints?project_id=...
    ep_resp = await client.get(f"/api/v1/endpoints?project_id={proj_id}")
    assert ep_resp.status_code == 200
    eps = ep_resp.json()["data"]
    assert len(eps) == 2
    paths = {ep["path"] for ep in eps}
    assert "/v1/users" in paths

    # 6. Verify duplicate submission is handled safely
    dup_resp = await client.post(
        f"/api/v1/discovery/{run.id}/accept",
        json={"candidate_ids": [str(c1.id), str(c2.id)]},
    )
    assert dup_resp.status_code == 200
    assert dup_resp.json()["data"]["created"] == 0
    assert dup_resp.json()["data"]["skipped"] == 2

