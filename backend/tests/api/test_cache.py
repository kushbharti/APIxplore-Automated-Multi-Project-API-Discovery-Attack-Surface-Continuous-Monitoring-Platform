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
