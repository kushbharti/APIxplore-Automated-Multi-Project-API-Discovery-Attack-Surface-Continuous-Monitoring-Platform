"""
tests/discovery/test_pipeline_and_neondb.py
============================================
Tests for NeonDB / PostgreSQL schema compatibility, StringUUIDMixin,
discovery candidate relationships, and project-scoped endpoint queries.
"""

from __future__ import annotations

import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.endpoint import Endpoint
from app.models.project import Project
from app.models.discovery_run import DiscoveryRun, DiscoveryStatus
from app.models.discovery_candidate import DiscoveryCandidate, VerificationStatus
from app.repositories.endpoint import EndpointRepository
from app.repositories.project import ProjectRepository
from app.repositories.discovery import DiscoveryRunRepository, DiscoveryCandidateRepository


@pytest.mark.asyncio
async def test_endpoint_query_by_project_id_compatibility(
    client: AsyncClient, admin_client: AsyncClient, db_session: AsyncSession
) -> None:
    """
    Verifies that querying endpoints by project_id does not trigger
    'operator does not exist: character varying = uuid' in PostgreSQL/NeonDB.
    """
    # 1. Create a project
    create_resp = await client.post(
        "/api/v1/projects",
        json={
            "name": "NeonDB Query Test Project",
            "url": "https://example.com/api/v1",
            "source_type": "WEBSITE",
        },
    )
    assert create_resp.status_code == 201
    proj_id = create_resp.json()["data"]["id"]
    assert isinstance(proj_id, str)

    # 2. Add endpoints scoped to this project
    ep1 = Endpoint(
        name="Users Endpoint",
        project_id=proj_id,
        method="GET",
        url="https://example.com/api/v1/users",
        path="/api/v1/users",
        health_state="HEALTHY",
        enabled=True,
    )
    ep2 = Endpoint(
        name="Orders Endpoint",
        project_id=proj_id,
        method="POST",
        url="https://example.com/api/v1/orders",
        path="/api/v1/orders",
        health_state="UNKNOWN",
        enabled=True,
    )
    # Also add an endpoint belonging to a different project
    ep3 = Endpoint(
        name="Unrelated Endpoint",
        project_id=str(uuid.uuid4()),
        method="GET",
        url="https://other.org/api/status",
        path="/api/status",
        health_state="HEALTHY",
        enabled=True,
    )
    db_session.add_all([ep1, ep2, ep3])
    await db_session.commit()

    # 3. Test list_endpoints via API with project_id filter
    resp = await admin_client.get(f"/api/v1/endpoints?project_id={proj_id}")
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert len(data) == 2
    returned_urls = [e["url"] for e in data]
    assert "https://example.com/api/v1/users" in returned_urls
    assert "https://example.com/api/v1/orders" in returned_urls
    assert "https://other.org/api/status" not in returned_urls

    # 4. Test direct repository get_all with project_id
    repo = EndpointRepository(db_session)
    eps = await repo.get_all(project_id=proj_id)
    assert len(eps) == 2
    assert all(e.project_id == proj_id for e in eps)


@pytest.mark.asyncio
async def test_discovery_models_string_uuid_and_relationships(
    db_session: AsyncSession,
) -> None:
    """
    Verifies that DiscoveryRun and DiscoveryCandidate models properly use StringUUIDMixin
    and handle foreign keys to Project without UUID cast errors.
    """
    # 1. Create a Project
    proj = Project(
        name="Discovery Pipeline NeonDB Target",
        url="https://api.pipeline.test",
        source_type="WEBSITE",
    )
    db_session.add(proj)
    await db_session.commit()
    await db_session.refresh(proj)
    assert isinstance(proj.id, str)
    assert len(proj.id) == 36

    # 2. Create a DiscoveryRun
    run = DiscoveryRun(
        project_id=proj.id,
        status=DiscoveryStatus.COMPLETED.value,
        openapi_checked=True,
        openapi_found=True,
        candidates_total=3,
        candidates_verified=2,
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)
    assert isinstance(run.id, str)
    assert len(run.id) == 36
    assert run.project_id == proj.id

    # 3. Create DiscoveryCandidates
    c1 = DiscoveryCandidate(
        run_id=run.id,
        project_id=proj.id,
        method="GET",
        path="/items",
        full_url="https://api.pipeline.test/items",
        source="OPENAPI",
        verification_status=VerificationStatus.VERIFIED.value,
        accepted=True,
    )
    c2 = DiscoveryCandidate(
        run_id=run.id,
        project_id=proj.id,
        method="POST",
        path="/items",
        full_url="https://api.pipeline.test/items",
        source="OPENAPI",
        verification_status=VerificationStatus.VERIFIED.value,
        accepted=False,
    )
    db_session.add_all([c1, c2])
    await db_session.commit()
    await db_session.refresh(c1)
    await db_session.refresh(c2)
    assert isinstance(c1.id, str)
    assert len(c1.id) == 36

    # 4. Query via DiscoveryRunRepository and DiscoveryCandidateRepository
    run_repo = DiscoveryRunRepository(db_session)
    fetched_run = await run_repo.get_by_id(run.id)
    assert fetched_run is not None
    assert fetched_run.id == run.id

    runs_for_proj = await run_repo.get_for_project(proj.id)
    assert len(runs_for_proj) >= 1
    assert runs_for_proj[0].id == run.id

    cand_repo = DiscoveryCandidateRepository(db_session)
    candidates = await cand_repo.get_for_run(run.id)
    assert len(candidates) == 2

    # 5. Mark accepted with endpoint_id string
    ep_id = str(uuid.uuid4())
    await cand_repo.mark_accepted(c2.id, ep_id)
    refreshed_c2 = await cand_repo.get_by_id(c2.id)
    assert refreshed_c2 is not None
    assert refreshed_c2.accepted is True
    assert refreshed_c2.endpoint_id == ep_id
