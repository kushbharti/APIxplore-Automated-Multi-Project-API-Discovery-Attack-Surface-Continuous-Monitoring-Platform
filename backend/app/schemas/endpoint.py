"""
app/schemas/endpoint.py
========================
Pydantic schemas for endpoint CRUD operations.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class EndpointCreate(BaseModel):
    """Body for POST /api/v1/endpoints."""

    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    method: str = Field(default="GET", pattern="^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$")
    url: str = Field(min_length=8, max_length=2048, description="Full URL to check")
    expected_status: int = Field(default=200, ge=100, le=599)
    timeout_ms: int = Field(default=5000, ge=100, le=60000)
    check_interval_seconds: int = Field(default=60, ge=5, le=3600)
    failure_threshold: int = Field(default=3, ge=1, le=20)
    latency_threshold_ms: int = Field(default=2000, ge=100, le=60000)
    enabled: bool = True
    tags: str | None = Field(default=None, max_length=500)
    project_id: uuid.UUID | None = None

    @field_validator("url")
    @classmethod
    def validate_url_scheme(cls, v: str) -> str:
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("URL must start with http:// or https://")
        return v


class EndpointUpdate(BaseModel):
    """Body for PATCH /api/v1/endpoints/{id} — all fields optional."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    method: str | None = Field(default=None, pattern="^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$")
    url: str | None = Field(default=None, min_length=8, max_length=2048)
    expected_status: int | None = Field(default=None, ge=100, le=599)
    timeout_ms: int | None = Field(default=None, ge=100, le=60000)
    check_interval_seconds: int | None = Field(default=None, ge=5, le=3600)
    failure_threshold: int | None = Field(default=None, ge=1, le=20)
    latency_threshold_ms: int | None = Field(default=None, ge=100, le=60000)
    enabled: bool | None = None
    tags: str | None = None


class EndpointOut(BaseModel):
    """Endpoint representation returned to API callers."""

    id: uuid.UUID
    project_id: uuid.UUID | None
    name: str
    description: str | None
    method: str
    url: str
    path: str | None
    expected_status: int
    timeout_ms: int
    check_interval_seconds: int
    failure_threshold: int
    latency_threshold_ms: int
    enabled: bool
    health_state: str
    discovery_source: str
    confidence: str
    last_checked_at: datetime | None
    tags: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class EndpointSummary(BaseModel):
    """Compact endpoint representation for list views."""

    id: uuid.UUID
    project_id: uuid.UUID | None
    name: str
    method: str
    url: str
    path: str | None
    enabled: bool
    health_state: str
    discovery_source: str
    confidence: str
    last_checked_at: datetime | None
    tags: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
