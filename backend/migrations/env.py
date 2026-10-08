"""
migrations/env.py
==================
Alembic environment configuration for async SQLAlchemy (asyncpg).

Key points:
- Uses run_async_migrations() because the project uses an async engine.
- Imports all models via app.models so Base.metadata is fully populated
  before --autogenerate introspects it.
- DATABASE_URL is read from the same settings as the application,
  ensuring migrations always target the correct database.
- compare_type=True causes column type changes to be detected by autogenerate.
"""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

# Import all models so Base.metadata is populated
import app.models  # noqa: F401 — side-effect import
from app.models.base import Base
from app.core.config import get_settings

# Alembic Config object from alembic.ini
config = context.config

# Set up Python logging from alembic.ini [loggers] section
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Metadata for autogenerate support
target_metadata = Base.metadata


def get_url() -> str:
    settings = get_settings()
    return settings.database_url_str


def run_migrations_offline() -> None:
    """
    Run migrations in 'offline' mode.

    In this mode, alembic emits SQL to stdout without connecting to the DB.
    Useful for generating SQL scripts to apply manually.
    """
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Run migrations using the async engine."""
    connectable = create_async_engine(
        get_url(),
        poolclass=pool.NullPool,  # no pooling for migrations
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    """Entry point for online migration (normal `alembic upgrade head`)."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
