"""
app/api/v1/auth.py
===================
Authentication endpoints.

Routes:
    POST /api/v1/auth/login      — exchange credentials for a JWT
    POST /api/v1/auth/register   — create a new user account (ADMIN only)
    GET  /api/v1/auth/me         — return the current authenticated user

Design:
- Route handlers are thin controllers — no business logic here.
- All logic is delegated to AuthService.
- Dependency injection provides the DB session and service.
- request_id is extracted from request.state (set by RequestIDMiddleware).
"""

from __future__ import annotations

from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import CurrentTokenData, require_roles
from app.db.session import get_db
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserOut
from app.schemas.common import DataResponse
from app.services.auth import AuthService

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication"])


# ---------------------------------------------------------------------------
# Dependency: build AuthService per request
# ---------------------------------------------------------------------------


def _get_auth_service(
    session: Annotated[AsyncSession, Depends(get_db)],
) -> AuthService:
    return AuthService(session)


AuthServiceDep = Annotated[AuthService, Depends(_get_auth_service)]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/login",
    response_model=DataResponse[TokenResponse],
    status_code=status.HTTP_200_OK,
    summary="Authenticate and receive a JWT access token",
)
async def login(
    body: LoginRequest,
    request: Request,
    auth_service: AuthServiceDep,
) -> DataResponse[TokenResponse]:
    """Exchange email + password for a JWT access token."""
    request_id: str = getattr(request.state, "request_id", "unknown")
    token_response = await auth_service.login(body.email, body.password)
    return DataResponse(data=token_response, request_id=request_id)


@router.post(
    "/register",
    response_model=DataResponse[UserOut],
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user account (ADMIN only)",
    dependencies=[require_roles("ADMIN")],
)
async def register(
    body: RegisterRequest,
    request: Request,
    auth_service: AuthServiceDep,
) -> DataResponse[UserOut]:
    """
    Create a new operator or viewer account.

    Requires ADMIN role. Returns the created user profile (no password).
    """
    request_id: str = getattr(request.state, "request_id", "unknown")
    user_out = await auth_service.register(body)
    return DataResponse(data=user_out, request_id=request_id)


@router.get(
    "/me",
    response_model=DataResponse[UserOut],
    status_code=status.HTTP_200_OK,
    summary="Return the current authenticated user's profile",
)
async def me(
    request: Request,
    token_data: CurrentTokenData,
    auth_service: AuthServiceDep,
) -> DataResponse[UserOut]:
    """Return profile of the authenticated user."""
    request_id: str = getattr(request.state, "request_id", "unknown")
    user_out = await auth_service.get_current_user(token_data.user_id)
    return DataResponse(data=user_out, request_id=request_id)
