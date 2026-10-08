"""
app/models/base.py
==================
SQLAlchemy declarative base and shared mixin columns.

All models in this project inherit from Base.
TimestampMixin adds created_at / updated_at columns to every model.
UUIDMixin provides a UUID primary key consistent across all tables.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """
    Project-wide SQLAlchemy declarative base.

    All models must inherit from this class.
    Alembic's env.py imports Base.metadata to generate migration scripts.
    """

    pass


class UUIDMixin:
    """
    Mixin that adds a UUID primary key column named 'id'.

    UUIDs are generated server-side by Python (not the database) so they
    are available before the INSERT is committed — useful for logging.
    """

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        nullable=False,
    )


class TimestampMixin:
    """
    Mixin that adds created_at and updated_at columns to a model.

    - created_at: set once at INSERT time (via server_default).
    - updated_at: updated automatically by SQLAlchemy's onupdate trigger.
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )
