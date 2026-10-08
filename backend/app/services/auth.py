"""
app/services/auth.py
=====================
Authentication business logic.

Responsibilities:
- Validate credentials and return a JWT token.
- Register new users.
- Retrieve the currently authenticated user from the DB.
- Seed the first admin on startup.

Design:
- All database access goes through UserRepository.
- Business logic (password validation, role rules) lives here, not in routes.
- Returns domain exceptions; routes translate these to HTTP responses
  via the centralized exception handlers in main.py.
"""

from __future__ import annotations

import re
import uuid

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.exceptions import AuthenticationError, NotFoundError
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User, UserRole
from app.repositories.user import UserRepository
from app.schemas.auth import RegisterRequest, TokenResponse, UserOut

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Password strength policy
# ---------------------------------------------------------------------------

_PASSWORD_PATTERN = re.compile(
    r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$"
)


def _validate_password_strength(password: str) -> None:
    """
    Enforce minimum password strength.

    Raises:
        ValueError: With a user-facing message if the password is too weak.
    """
    if not _PASSWORD_PATTERN.match(password):
        raise ValueError(
            "Password must be at least 8 characters and contain an uppercase letter, "
            "a lowercase letter, and a digit."
        )


# ---------------------------------------------------------------------------
# AuthService
# ---------------------------------------------------------------------------


class AuthService:
    """
    Business logic for authentication and user management.

    Instantiated per-request; receives a scoped AsyncSession.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._repo = UserRepository(session)

    async def login(self, email: str, password: str) -> TokenResponse:
        """
        Authenticate a user by email + password.

        Returns:
            TokenResponse with a signed JWT.

        Raises:
            AuthenticationError: If credentials are invalid or the account is inactive.
        """
        user = await self._repo.get_by_email(email)

        # Use constant-time comparison to prevent user enumeration
        if user is None or not verify_password(password, user.hashed_password):
            logger.warning("login_failed", email=email)
            raise AuthenticationError("Invalid email or password.")

        if not user.is_active:
            logger.warning("login_inactive_account", user_id=str(user.id))
            raise AuthenticationError("Account is disabled. Contact an administrator.")

        settings = get_settings()
        token = create_access_token(
            subject=str(user.id),
            role=user.role,
        )
        logger.info("login_success", user_id=str(user.id), role=user.role)

        return TokenResponse(
            access_token=token,
            token_type="bearer",
            expires_in=settings.access_token_expire_minutes * 60,
        )

    async def register(self, request: RegisterRequest) -> UserOut:
        """
        Register a new user account.

        Raises:
            ValueError: If the password does not meet strength requirements.
            ConflictError: If the email is already registered (raised by repository).
        """
        _validate_password_strength(request.password)

        user = User(
            email=request.email,
            hashed_password=hash_password(request.password),
            full_name=request.full_name,
            role=request.role,
            is_active=True,
        )
        created = await self._repo.create(user)
        logger.info("user_registered", user_id=str(created.id), role=created.role)
        return UserOut.model_validate(created)

    async def get_current_user(self, user_id: str) -> UserOut:
        """
        Return the authenticated user's profile.

        Raises:
            NotFoundError: If the user no longer exists (e.g. deleted after token issued).
            AuthenticationError: If the user is inactive.
        """
        uid = uuid.UUID(user_id)
        user = await self._repo.get_by_id(uid)

        if user is None:
            raise NotFoundError("User", user_id)

        if not user.is_active:
            raise AuthenticationError("Account is disabled.")

        return UserOut.model_validate(user)

    async def seed_first_admin(self) -> None:
        """
        Create the initial admin account if no users exist.

        This is called during application startup when FIRST_ADMIN_EMAIL
        and FIRST_ADMIN_PASSWORD are configured. Safe to call multiple times
        (idempotent — only acts if users table is empty).
        """
        settings = get_settings()
        if not settings.first_admin_email or not settings.first_admin_password:
            return

        count = await self._repo.count()
        if count > 0:
            return  # Already have users — do not override

        logger.warning(
            "seeding_first_admin",
            email=settings.first_admin_email,
            note="Change this password immediately in production.",
        )
        user = User(
            email=settings.first_admin_email,
            hashed_password=hash_password(settings.first_admin_password),
            full_name="System Administrator",
            role=UserRole.ADMIN.value,
            is_active=True,
        )
        await self._repo.create(user)
        logger.info("first_admin_created", email=settings.first_admin_email)
