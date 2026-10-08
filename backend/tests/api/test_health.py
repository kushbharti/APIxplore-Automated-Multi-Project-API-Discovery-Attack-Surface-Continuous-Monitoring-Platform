"""
tests/api/test_health.py
=========================
Tests for /health/live and /health/ready endpoints.

Validates:
- Liveness always returns 200.
- Response body matches HealthStatus schema.
- Readiness returns 200 or 503 depending on DB connectivity.
- X-Request-ID is present in all responses.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_liveness_returns_200(client: AsyncClient) -> None:
    """GET /health/live must always return 200."""
    response = await client.get("/health/live")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_liveness_response_body(client: AsyncClient) -> None:
    """Liveness response contains expected fields."""
    response = await client.get("/health/live")
    body = response.json()

    assert body["status"] == "alive"
    assert "version" in body
    assert "environment" in body


@pytest.mark.asyncio
async def test_liveness_has_request_id_header(client: AsyncClient) -> None:
    """X-Request-ID header must be present in every response."""
    response = await client.get("/health/live")
    assert "x-request-id" in response.headers


@pytest.mark.asyncio
async def test_readiness_returns_response(client: AsyncClient) -> None:
    """
    GET /health/ready returns either 200 or 503 (depending on DB state).
    Both are valid — the test only checks the response is parseable.
    """
    response = await client.get("/health/ready")
    assert response.status_code in (200, 503)


@pytest.mark.asyncio
async def test_readiness_response_envelope(client: AsyncClient) -> None:
    """Readiness response always follows DataResponse envelope."""
    response = await client.get("/health/ready")
    body = response.json()

    # Must always have data and request_id at the envelope level
    assert "data" in body
    assert "request_id" in body

    data = body["data"]
    assert "status" in data
    assert "checks" in data
    assert "postgresql" in data["checks"]


@pytest.mark.asyncio
async def test_request_id_propagation(client: AsyncClient) -> None:
    """If client sends X-Request-ID, it must be echoed back."""
    custom_id = "req_custom_abc123"
    response = await client.get(
        "/health/live",
        headers={"X-Request-ID": custom_id},
    )
    assert response.headers.get("x-request-id") == custom_id
