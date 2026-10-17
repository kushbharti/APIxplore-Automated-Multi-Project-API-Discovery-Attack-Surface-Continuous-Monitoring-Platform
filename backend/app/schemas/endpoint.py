"""
app/schemas/endpoint.py
========================
Pydantic schemas for endpoint CRUD operations.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

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
    project_id: uuid.UUID | str | None = None

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
    project_id: uuid.UUID | str | None = None
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
    project_id: uuid.UUID | str | None = None
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


class ParameterField(BaseModel):
    name: str
    in_: str = Field(description="Parameter location: path, query, or header", alias="in")
    required: bool = False
    type: str = "string"
    description: str | None = None
    default: str | int | float | bool | None = None
    enum: list[str | int | float] | None = None

    model_config = {"populate_by_name": True}


class BodyField(BaseModel):
    name: str
    type: str = "string"
    required: bool = False
    description: str | None = None
    default: Any = None
    enum: list[Any] | None = None
    fields: list[BodyField] = Field(default_factory=list)
    item_type: str | None = None
    item_fields: list[BodyField] = Field(default_factory=list)


class RequestBodySchema(BaseModel):
    content_type: str = "application/json"
    content_types: list[str] = Field(default_factory=lambda: ["application/json"])
    required: bool = False
    fields: list[BodyField] = Field(default_factory=list)
    raw_schema: dict | None = None


class EndpointSchemaOut(BaseModel):
    endpoint_id: uuid.UUID
    method: str
    url: str
    path: str
    path_parameters: list[ParameterField] = Field(default_factory=list)
    query_parameters: list[ParameterField] = Field(default_factory=list)
    headers: list[ParameterField] = Field(default_factory=list)
    request_body: RequestBodySchema | None = None


BodyField.model_rebuild()
RequestBodySchema.model_rebuild()
EndpointSchemaOut.model_rebuild()


class EndpointCheckRequest(BaseModel):
    path_params: dict[str, str] | None = None
    query_params: dict[str, str] | None = None
    headers: dict[str, str] | None = None
    body: str | dict | list | int | float | bool | None = None
    content_type: str | None = None
