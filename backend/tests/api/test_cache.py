"""
tests/api/test_cache.py
========================
Tests for the intelligent cache endpoints.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.cache.policies import get_policy


@pytest.mark.asyncio
async def test_get_cache_status(user_client: AsyncClient) -> None:
    response = await user_client.get("/api/v1/cache/status")
    assert response.status_code == 200
    data = response.json()["data"]
    assert "redis_available" in data
    assert "policies_count" in data


@pytest.mark.asyncio
async def test_get_cache_policies(user_client: AsyncClient) -> None:
    response = await user_client.get("/api/v1/cache/policies")
    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) > 0
    assert any(p["resource"] == "profile" for p in data)


@pytest.mark.asyncio
async def test_get_cached_resource_miss_then_hit(user_client: AsyncClient) -> None:
    # 1. First fetch — MISS (fetches from origin)
    response1 = await user_client.get("/api/v1/cache/resource/profile")
    assert response1.status_code == 200
    data1 = response1.json()["data"]
    assert data1["source"] == "origin"
    assert data1["data"]["name"] == "Demo User"

    # 2. Second fetch — HIT (fetches from cache)
    response2 = await user_client.get("/api/v1/cache/resource/profile")
    assert response2.status_code == 200
    data2 = response2.json()["data"]
    assert data2["source"] == "cache"
    assert data2["data"]["name"] == "Demo User"


@pytest.mark.asyncio
async def test_invalidate_cache(user_client: AsyncClient) -> None:
    # 1. Ensure cached
    await user_client.get("/api/v1/cache/resource/profile")

    # 2. Invalidate
    del_resp = await user_client.delete("/api/v1/cache/resource/profile")
    assert del_resp.status_code == 204

    # 3. Third fetch — MISS again
    response3 = await user_client.get("/api/v1/cache/resource/profile")
    assert response3.status_code == 200
    assert response3.json()["data"]["source"] == "origin"


@pytest.mark.asyncio
async def test_get_unknown_resource(user_client: AsyncClient) -> None:
    response = await user_client.get("/api/v1/cache/resource/unknown_item")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "no_data"
