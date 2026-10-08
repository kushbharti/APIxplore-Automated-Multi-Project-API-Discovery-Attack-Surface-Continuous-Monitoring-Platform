"""
app/repositories/user.py
=========================
Data access layer for User entities.

Responsibilities:
- All SQL queries relating to users live here.
- Repository methods raise domain exceptions (DatabaseUnavailableError, etc.)
  rather than exposing raw SQLAlchemy errors.
- No business logic — that belongs in the service layer.

Pattern:
- Receives an AsyncSession via dependency injection.
- Methods are async.
- Translates SQLAlchemy exceptions into domain exceptions.
"""

from __future__ import annotations

import uuid

import structlog
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError, TimeoutError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ConflictError,
    DatabaseQueryError,
    DatabaseTimeoutError,
    DatabaseUnavailableError,
)
from app.models.user import User

logger = structlog.get_logger(__name__)


class UserRepository:
    """
    Handles all database operations for the User model.

    Injected with an AsyncSession per request.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        """Return a User by primary key, or None if not found."""
        try:
            result = await self._session.get(User, user_id)
            return result
        except TimeoutError as exc:
            logger.warning("db_timeout", operation="get_user_by_id", user_id=str(user_id))
            raise DatabaseTimeoutError() from exc
        except OperationalError as exc:
            logger.error("db_unavailable", operation="get_user_by_id")
            raise DatabaseUnavailableError() from exc

    async def get_by_email(self, email: str) -> User | None:
        """Return a User by email address (case-sensitive), or None if not found."""
        try:
            stmt = select(User).where(User.email == email)
            result = await self._session.execute(stmt)
            return result.scalar_one_or_none()
        except TimeoutError as exc:
            logger.warning("db_timeout", operation="get_user_by_email")
            raise DatabaseTimeoutError() from exc
        except OperationalError as exc:
            logger.error("db_unavailable", operation="get_user_by_email")
            raise DatabaseUnavailableError() from exc

    async def create(self, user: User) -> User:
        """
        Persist a new User to the database.

        Raises:
            ConflictError: If email already exists (IntegrityError on unique constraint).
            DatabaseQueryError: For unexpected database errors.
        """
        try:
            self._session.add(user)
            await self._session.flush()  # flush to get DB-generated defaults (e.g. timestamps)
            return user
        except IntegrityError as exc:
            await self._session.rollback()
            constraint = str(exc.orig) if exc.orig else ""
            if "users_email" in constraint or "unique" in constraint.lower():
                raise ConflictError(
                    f"A user with email '{user.email}' already exists."
                ) from exc
            logger.error("db_integrity_error", operation="create_user", detail=constraint)
            raise DatabaseQueryError("Failed to create user due to a constraint violation.") from exc
        except TimeoutError as exc:
            raise DatabaseTimeoutError() from exc
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc

    async def count(self) -> int:
        """Return total number of users. Used for first-admin seeding."""
        try:
            from sqlalchemy import func  # local import to keep top-level clean

            stmt = select(func.count()).select_from(User)
            result = await self._session.execute(stmt)
            return result.scalar_one()
        except OperationalError as exc:
            raise DatabaseUnavailableError() from exc
