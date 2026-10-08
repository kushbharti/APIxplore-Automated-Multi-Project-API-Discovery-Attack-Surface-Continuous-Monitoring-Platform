"""
tests/conftest.py
==================
Shared pytest fixtures for the entire test suite.

Strategy:
- Uses an in-memory SQLite database for fast unit/API tests.
  (Phase integration tests that NEED PostgreSQL behaviour are marked
  with @pytest.mark.integration and can be skipped in CI fast path.)
- Overrides the database URL via get_settings() cache clear and env patch.
- Provides:
    app         — fresh FastAPI app instance
    client      — AsyncClient for sending test requests
    db_session  — raw async session for setup/teardown in tests
    admin_token — pre-generated JWT for the seeded admin user
"""

from __future__ import annotations

import asyncio
import os
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# ---------------------------------------------------------------------------
# Override settings BEFORE the app is imported
# ---------------------------------------------------------------------------

os.environ.setdefault("SECRET_KEY", "test-secret-key-min-32-chars-long-abc")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test.db")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")
os.environ.setdefault("LOG_FORMAT", "console")
os.environ.setdefault("FIRST_ADMIN_EMAIL", "admin@test.com")
os.environ.setdefault("FIRST_ADMIN_PASSWORD", "AdminTest1234!")

from app.core.config import get_settings  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.db import session as db_session_module  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.base import Base  # noqa: E402
from app.models.user import UserRole  # noqa: E402

# ---------------------------------------------------------------------------
# Test database engine (SQLite in-memory / file)
# ---------------------------------------------------------------------------

TEST_DB_URL = "sqlite+aiosqlite:///./test.db"

_test_engine = create_async_engine(
    TEST_DB_URL,
    echo=False,
    connect_args={"check_same_thread": False},
)

_test_session_factory = async_sessionmaker(
    bind=_test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_test_database() -> AsyncGenerator[None, None]:
    """Create all tables once per test session; drop them afterwards."""
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await _test_engine.dispose()


@pytest_asyncio.fixture()
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Provide a clean session per test, always rolled back."""
    async with _test_session_factory() as session:
        yield session
        await session.rollback()


# ---------------------------------------------------------------------------
# FastAPI test app + client
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture()
async def app_instance() -> object:
    """
    Fresh FastAPI app for each test.
    Patches the DB session dependency to use our test session factory.
    """
    # Clear settings cache so test env vars are picked up
    get_settings.cache_clear()

    # Patch the engine/session factory used by the app
    db_session_module._engine = _test_engine
    db_session_module._async_session_factory = _test_session_factory

    return create_app()


@pytest_asyncio.fixture()
async def client(app_instance: object) -> AsyncGenerator[AsyncClient, None]:
    """AsyncClient pointing at the test app."""
    async with AsyncClient(
        transport=ASGITransport(app=app_instance),  # type: ignore[arg-type]
        base_url="http://test",
    ) as ac:
        yield ac


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------


@pytest.fixture()
def admin_token() -> str:
    """Return a valid ADMIN JWT for test requests."""
    return create_access_token(subject="00000000-0000-0000-0000-000000000001", role="ADMIN")


@pytest.fixture()
def viewer_token() -> str:
    """Return a valid VIEWER JWT for test requests."""
    return create_access_token(subject="00000000-0000-0000-0000-000000000002", role="VIEWER")


@pytest.fixture()
def auth_headers(admin_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture()
def viewer_headers(viewer_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {viewer_token}"}


@pytest_asyncio.fixture()
async def admin_client(app_instance: object, admin_token: str) -> AsyncGenerator[AsyncClient, None]:
    async with AsyncClient(
        transport=ASGITransport(app=app_instance),
        base_url="http://test",
        headers={"Authorization": f"Bearer {admin_token}"}
    ) as ac:
        yield ac


@pytest_asyncio.fixture()
async def user_client(app_instance: object, viewer_token: str) -> AsyncGenerator[AsyncClient, None]:
    async with AsyncClient(
        transport=ASGITransport(app=app_instance),
        base_url="http://test",
        headers={"Authorization": f"Bearer {viewer_token}"}
    ) as ac:
        yield ac
