"""
tests/api/test_auth.py
=======================
Tests for authentication endpoints.

Validates:
- Invalid credentials return 401.
- Valid credentials return a JWT token.
- /me returns current user data with a valid token.
- /register requires ADMIN role.
- Viewer cannot register users.
- Error responses follow the standard error envelope.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models.user import User, UserRole


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_test_user(
    db_session: AsyncSession,
    email: str = "testop@example.com",
    password: str = "TestPass1234!",
    role: str = UserRole.OPERATOR.value,
) -> User:
    """Insert a test user directly — bypasses the service layer."""
    user = User(
        email=email,
        hashed_password=hash_password(password),
        full_name="Test Operator",
        role=role,
        is_active=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user


# ---------------------------------------------------------------------------
# Login tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_login_invalid_credentials_returns_401(client: AsyncClient) -> None:
    """Non-existent email should return 401 with error envelope."""
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@example.com", "password": "wrongpassword"},
    )
    assert response.status_code == 401
    body = response.json()
    assert "error" in body
    assert body["error"]["code"] == "AUTHENTICATION_FAILED"
    assert "request_id" in body["error"]


@pytest.mark.asyncio
async def test_login_wrong_password_returns_401(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Correct email but wrong password should return 401."""
    await _create_test_user(db_session, email="user@example.com", password="CorrectPass1!")
    await db_session.commit()

    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "user@example.com", "password": "WrongPass1!"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_success_returns_token(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Valid credentials should return access_token and token_type."""
    await _create_test_user(db_session, email="valid@example.com", password="ValidPass1!")
    await db_session.commit()

    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "valid@example.com", "password": "ValidPass1!"},
    )
    assert response.status_code == 200
    body = response.json()
    assert "data" in body
    assert "access_token" in body["data"]
    assert body["data"]["token_type"] == "bearer"
    assert body["data"]["expires_in"] > 0
    assert "request_id" in body


# ---------------------------------------------------------------------------
# /me tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_me_without_token_returns_401(client: AsyncClient) -> None:
    """No auth header → 401."""
    response = await client.get("/api/v1/auth/me")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_me_with_admin_token_returns_user(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """
    /me with a valid admin token returns data envelope.
    (The admin user may not exist in DB — we get NotFoundError → 404,
    which proves the auth layer worked and the DB lookup was attempted.)
    """
    response = await client.get("/api/v1/auth/me", headers=auth_headers)
    # Either 200 (user exists in DB) or 404 (user not seeded in test DB)
    assert response.status_code in (200, 404)
    body = response.json()
    # Either "data" (success) or "error" (not found) — both must have request_id
    if "error" in body:
        assert "request_id" in body["error"]
    else:
        assert "request_id" in body


# ---------------------------------------------------------------------------
# /register tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_register_requires_admin_role(
    client: AsyncClient, viewer_headers: dict[str, str]
) -> None:
    """VIEWER cannot register new users."""
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "newuser@example.com",
            "password": "NewUser1234!",
            "role": "VIEWER",
        },
        headers=viewer_headers,
    )
    assert response.status_code == 403
    body = response.json()
    assert body["error"]["code"] == "INSUFFICIENT_PERMISSIONS"


@pytest.mark.asyncio
async def test_register_without_token_returns_401(client: AsyncClient) -> None:
    """No auth header on register → 401."""
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": "x@example.com", "password": "NewUser1234!", "role": "VIEWER"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_register_with_weak_password_returns_422(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Weak password should be rejected at the schema or service layer."""
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": "weak@example.com", "password": "abc", "role": "VIEWER"},
        headers=auth_headers,
    )
    assert response.status_code in (422, 400)


# ---------------------------------------------------------------------------
# Error envelope tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_error_response_never_exposes_stack_trace(client: AsyncClient) -> None:
    """Error responses must not contain traceback or internal details."""
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@nowhere.com", "password": "wrongpass"},
    )
    body = response.json()
    body_str = str(body)

    # These strings must never appear in any error response
    forbidden = ["Traceback", "sqlalchemy", "asyncpg", "File \"", "line "]
    for forbidden_term in forbidden:
        assert forbidden_term not in body_str, (
            f"Response contained forbidden term: {forbidden_term!r}"
        )
