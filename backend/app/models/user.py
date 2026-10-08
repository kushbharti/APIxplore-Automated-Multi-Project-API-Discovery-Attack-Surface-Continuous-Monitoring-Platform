"""
app/models/user.py
==================
User model representing authenticated operators and administrators.

Roles:
    VIEWER   — read-only access to dashboards and incident history
    OPERATOR — manage endpoints, investigate incidents
    ADMIN    — configure recovery policies, execute privileged actions,
               manage alert rules, use failure-injection endpoints

Design notes:
- Passwords are stored as bcrypt hashes only — never in plaintext.
- is_active allows soft-disabling users without deleting their audit history.
- role is stored as a VARCHAR rather than a PostgreSQL ENUM so that
  Alembic migrations remain straightforward.
"""

from __future__ import annotations

import enum

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class UserRole(str, enum.Enum):
    """RBAC roles. Values match the strings stored in the JWT 'role' claim."""

    VIEWER = "VIEWER"
    OPERATOR = "OPERATOR"
    ADMIN = "ADMIN"


class User(UUIDMixin, TimestampMixin, Base):
    """
    Operator / administrator account.

    Table: users
    """

    __tablename__ = "users"

    email: Mapped[str] = mapped_column(
        String(254),
        unique=True,
        nullable=False,
        index=True,
        comment="RFC 5321 max email length",
    )

    hashed_password: Mapped[str] = mapped_column(
        String(72),  # bcrypt output is always 60 chars; 72 gives headroom
        nullable=False,
        comment="bcrypt hash — never store plaintext",
    )

    full_name: Mapped[str | None] = mapped_column(
        String(200),
        nullable=True,
    )

    role: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=UserRole.VIEWER.value,
        index=True,
        comment="VIEWER | OPERATOR | ADMIN",
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        comment="Soft-disable without deleting audit history",
    )

    def __repr__(self) -> str:
        return f"User(id={self.id!s}, email={self.email!r}, role={self.role!r})"
