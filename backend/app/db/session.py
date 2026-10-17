"""
app/db/session.py
==================
Async SQLAlchemy engine and session factory.

Responsibilities:
- Create the async engine (asyncpg driver)
- Provide an async session factory
- Expose get_db() FastAPI dependency that yields a session per request
  and commits/rolls back appropriately
- Expose check_db_health() for the /health/ready endpoint

Design notes:
- Connection pool settings are driven by config, not hardcoded.
- SQLAlchemy errors at the repository layer are translated to domain
  exceptions (DatabaseUnavailableError, DatabaseTimeoutError, DatabaseQueryError)
  — not here; that translation belongs in the repository layer.
- The engine is a module-level singleton created once at startup.
"""

from __future__ import annotations

from typing import AsyncGenerator

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Engine & session factory — created at import time so that tests can
# override them before app startup by patching this module.
# ---------------------------------------------------------------------------

_engine: AsyncEngine | None = None
_async_session_factory: async_sessionmaker[AsyncSession] | None = None


from sqlalchemy.engine.url import make_url
from typing import Any

def parse_db_url_and_connect_args(url_str: str) -> tuple[str, dict[str, Any]]:
    """
    Parse a database URL and build appropriate connect_args for the driver.

    Handles:
    - SQLite: check_same_thread=False, timeout=15
    - NeonDB / PostgreSQL:
      - Normalizes/strips 'sslmode' query param so asyncpg does not raise
        'connect() got an unexpected keyword argument sslmode'
      - Translates sslmode=require to connect_args={'ssl': 'require'}
      - Sets statement_cache_size=0 for Neon pooler (PgBouncer) compatibility
      - Enforces SSL for any host containing neon.tech
    """
    if url_str.startswith("sqlite"):
        return url_str, {"check_same_thread": False, "timeout": 15}

    url = make_url(url_str)
    query = dict(url.query)
    connect_args: dict[str, Any] = {}

    ssl_mode = None
    libpq_params = ("sslmode", "channel_binding", "gssencmode", "sslcert", "sslkey", "sslrootcert", "sslcrl")
    for param in libpq_params:
        val = query.pop(param, None)
        if param == "sslmode" and val:
            ssl_mode = val
    ssl_param = query.pop("ssl", None)

    is_neon = bool(url.host and "neon.tech" in url.host)
    is_pooler = bool(url.host and "pooler" in url.host)

    if is_neon or ssl_mode or ssl_param:
        connect_args["ssl"] = ssl_mode or ssl_param or "require"

    if is_neon or is_pooler:
        # PgBouncer / Neon connection pooler does not support prepared statement caches
        connect_args["statement_cache_size"] = 0

    clean_url = url._replace(query=query)
    return clean_url.render_as_string(hide_password=False), connect_args


def _build_engine() -> AsyncEngine:
    settings = get_settings()
    url = settings.database_url_str
    clean_url, connect_args = parse_db_url_and_connect_args(url)

    # SQLite (used in tests) does not support pool_size/max_overflow
    if clean_url.startswith("sqlite"):
        return create_async_engine(
            clean_url,
            echo=settings.db_echo,
            connect_args=connect_args,
            poolclass=StaticPool,
        )

    return create_async_engine(
        clean_url,
        echo=settings.db_echo,
        connect_args=connect_args,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout,
        pool_pre_ping=True,
        pool_recycle=300,
    )


def get_engine() -> AsyncEngine:
    """Return the singleton async engine, creating it on first call."""
    global _engine  # noqa: PLW0603
    if _engine is None:
        _engine = _build_engine()
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return the singleton session factory, creating it on first call."""
    global _async_session_factory  # noqa: PLW0603
    if _async_session_factory is None:
        _async_session_factory = async_sessionmaker(
            bind=get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,  # avoid implicit loads after commit
            autoflush=False,
            autocommit=False,
        )
    return _async_session_factory


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency: yields a database session for one request.

    - Commits on clean exit.
    - Rolls back on any exception (letting the exception propagate).
    - Always closes the session in the finally block.

    Repository methods must NOT call session.commit() themselves —
    that responsibility belongs here to enable unit-of-work across
    multiple repository calls in a single request.
    """
    factory = get_session_factory()
    session: AsyncSession = factory()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


async def check_db_health() -> bool:
    """
    Execute a cheap query to verify the database is reachable.
    Used by /health/ready.

    Returns True if healthy, False if unreachable.
    Does NOT raise — health checks must always return a response.
    """
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        logger.exception("db_health_check_failed")
        return False


async def close_engine() -> None:
    """
    Dispose the engine connection pool.
    Called during application shutdown (lifespan).
    """
    global _engine  # noqa: PLW0603
    if _engine is not None:
        await _engine.dispose()
        logger.info("db_engine_disposed")
        _engine = None
