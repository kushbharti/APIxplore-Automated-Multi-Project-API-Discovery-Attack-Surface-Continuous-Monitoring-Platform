"""
app/schemas/auth.py
====================
Pydantic schemas for authentication endpoints.

Separation from ORM models:
- UserOut is what callers receive — never exposes hashed_password.
- LoginRequest / RegisterRequest are what callers send.
- TokenResponse is the JWT response.
"""

from __future__ import annotations

import uuid

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    """OAuth2-compatible password login body."""

    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RegisterRequest(BaseModel):
    """New operator/admin registration."""

    email: EmailStr
    password: str = Field(
        min_length=8,
        max_length=128,
        description="Minimum 8 characters. Must include upper, lower, digit.",
    )
    full_name: str | None = Field(default=None, max_length=200)
    role: str = Field(
        default="VIEWER",
        pattern="^(VIEWER|OPERATOR|ADMIN)$",
        description="VIEWER | OPERATOR | ADMIN",
    )


class TokenResponse(BaseModel):
    """JWT access token returned after successful login."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="Token TTL in seconds")


class UserOut(BaseModel):
    """
    Safe user representation returned to callers.
    Never includes hashed_password or any other internal field.
    """

    id: uuid.UUID
    email: EmailStr
    full_name: str | None
    role: str
    is_active: bool

    model_config = {"from_attributes": True}
