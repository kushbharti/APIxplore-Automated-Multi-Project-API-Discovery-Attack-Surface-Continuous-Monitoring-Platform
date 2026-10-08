"""
app/schemas/common.py
======================
Shared response envelope schemas used across all API endpoints.

Design:
- Every successful response wraps data in {"data": ..., "request_id": ...}.
- Every error response uses {"error": {"code": ..., "message": ..., "request_id": ...}}.
- Consistent envelopes make client-side parsing predictable.
- request_id is always included so operators can correlate API errors with logs.
"""

from __future__ import annotations

from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class DataResponse(BaseModel, Generic[T]):
    """
    Standard success response envelope.

    Example:
        {"data": {...}, "request_id": "req_abc123"}
    """

    data: T
    request_id: str = Field(description="Unique identifier for this request (for log correlation)")
    meta: dict[str, Any] | None = Field(default=None, description="Optional pagination/context metadata")

    model_config = {"from_attributes": True}


class ErrorDetail(BaseModel):
    """Inner error object."""

    code: str = Field(description="Machine-readable error code")
    message: str = Field(description="Human-readable error description (safe for operators)")
    request_id: str = Field(description="Request identifier for log correlation")


class ErrorResponse(BaseModel):
    """
    Standard error response envelope.

    Example:
        {"error": {"code": "NOT_FOUND", "message": "...", "request_id": "req_abc123"}}
    """

    error: ErrorDetail


class PaginatedResponse(BaseModel, Generic[T]):
    """
    Standard paginated list response.

    Example:
        {"data": [...], "total": 42, "page": 1, "page_size": 20, "request_id": "req_abc123"}
    """

    data: list[T]
    total: int
    page: int
    page_size: int
    request_id: str

    model_config = {"from_attributes": True}


class HealthStatus(BaseModel):
    """Response schema for /health/live and /health/ready."""

    status: str
    checks: dict[str, Any] = Field(default_factory=dict)
    version: str
    environment: str
