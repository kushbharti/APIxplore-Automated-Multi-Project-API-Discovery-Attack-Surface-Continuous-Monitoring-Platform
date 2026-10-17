"""
app/schemas/project.py
=======================
Pydantic schemas for Project and Discovery operations.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

# ---------------------------------------------------------------------------
# Project schemas
# ---------------------------------------------------------------------------


class TargetAuthConfig(BaseModel):
    """Ephemeral credentials or OAuth token for discovering protected target websites."""
    auth_type: Literal["CREDENTIALS", "GOOGLE_OAUTH"] = "CREDENTIALS"
    username_or_email: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, max_length=255)
    oauth_token: str | None = Field(default=None, max_length=4096)


class DiscoveryStartRequest(BaseModel):
    """Optional payload when initiating a discovery run."""
    auth_config: TargetAuthConfig | None = None


class ProjectCreate(BaseModel):
    """Body for POST /api/v1/projects."""

    name: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=8, max_length=2048, description="Target website or API root URL")
    description: str | None = Field(default=None, max_length=1000)
    source_type: Literal["WEBSITE", "API", "AUTH_WEBSITE"] = "WEBSITE"
    deployment_url: str | None = Field(
        default=None,
        max_length=2048,
        description="Optional secondary or staging deployment URL",
    )
    auth_config: TargetAuthConfig | None = Field(
        default=None,
        description="Ephemeral target authentication configuration; never persisted in DB",
    )

    @field_validator("url")
    @classmethod
    def validate_url_scheme(cls, v: str) -> str:
        trimmed = v.strip()
        if not (trimmed.startswith("http://") or trimmed.startswith("https://")):
            raise ValueError("URL must start with http:// or https://")
        return trimmed

    @field_validator("deployment_url")
    @classmethod
    def validate_deployment_url(cls, v: str | None) -> str | None:
        if v is None:
            return None
        trimmed = v.strip()
        if not (trimmed.startswith("http://") or trimmed.startswith("https://")):
            raise ValueError("Deployment URL must start with http:// or https://")
        return trimmed


class ProjectUpdate(BaseModel):
    """Body for PATCH /api/v1/projects/{id}."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    url: str | None = Field(default=None, min_length=8, max_length=2048)
    description: str | None = None


class ProjectOut(BaseModel):
    """Project representation returned to API callers."""

    id: uuid.UUID | str
    name: str
    url: str
    description: str | None
    source_type: str = "WEBSITE"
    deployment_url: str | None = None
    status: str
    health_score: float | None
    endpoint_count: int
    healthy_count: int
    degraded_count: int
    down_count: int
    unknown_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectSummary(BaseModel):
    """Compact project representation for list views."""

    id: uuid.UUID | str
    name: str
    url: str
    source_type: str = "WEBSITE"
    deployment_url: str | None = None
    status: str
    health_score: float | None
    endpoint_count: int
    healthy_count: int
    degraded_count: int
    down_count: int
    unknown_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Discovery schemas
# ---------------------------------------------------------------------------


class DiscoveryRunOut(BaseModel):
    """Discovery run status."""

    id: uuid.UUID | str
    project_id: uuid.UUID | str
    status: str
    started_at: datetime | None
    completed_at: datetime | None
    openapi_checked: bool
    crawl_checked: bool
    js_checked: bool
    github_checked: bool = False
    openapi_found: bool
    openapi_url: str | None
    candidates_total: int
    candidates_verified: int
    candidates_unavailable: int
    candidates_blocked: int
    error_message: str | None = None
    provider_results: dict | None = None
    progress_state: dict | None = None
    created_at: datetime

    @model_validator(mode="before")
    @classmethod
    def parse_json_fields(cls, data: Any) -> Any:
        # If it's not a dict, extract fields into a dict to avoid mutating the ORM object
        if not isinstance(data, dict):
            # We only care about fields that exist in the schema
            dict_data = {
                k: getattr(data, k) 
                for k in cls.model_fields.keys() 
                if hasattr(data, k)
            }
        else:
            # Shallow copy to avoid mutating original dict if needed, 
            # though mutating a dict is safer than mutating an ORM object.
            dict_data = dict(data)
            
        if "provider_results" in dict_data and isinstance(dict_data["provider_results"], str):
            try:
                dict_data["provider_results"] = json.loads(dict_data["provider_results"])
            except Exception:
                dict_data["provider_results"] = None
        if "progress_state" in dict_data and isinstance(dict_data["progress_state"], str):
            try:
                dict_data["progress_state"] = json.loads(dict_data["progress_state"])
            except Exception:
                dict_data["progress_state"] = None
        
        return dict_data

    model_config = {"from_attributes": True}


class DiscoveryCandidateOut(BaseModel):
    """Discovery candidate."""

    id: uuid.UUID | str
    run_id: uuid.UUID | str
    method: str
    path: str
    full_url: str
    source: str
    confidence: str
    operation_id: str | None
    summary: str | None
    tags: str | None
    verification_status: str
    http_status: int | None
    response_time_ms: float | None
    verification_error: str | None
    accepted: bool
    endpoint_id: uuid.UUID | str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AcceptCandidatesRequest(BaseModel):
    """Body for POST /api/v1/discovery/{run_id}/accept."""

    candidate_ids: list[uuid.UUID | str] = Field(
        min_length=1, max_length=200, description="IDs of candidates to accept"
    )
    check_interval_seconds: int = Field(default=60, ge=5, le=3600)
    failure_threshold: int = Field(default=3, ge=1, le=20)
    latency_threshold_ms: int = Field(default=2000, ge=100, le=60000)
    timeout_ms: int = Field(default=5000, ge=100, le=60000)
    enabled: bool = True


# ---------------------------------------------------------------------------
# Analytics schemas
# ---------------------------------------------------------------------------


class OverviewStats(BaseModel):
    """Platform-wide overview KPIs."""

    total_projects: int
    total_endpoints: int
    enabled_endpoints: int
    healthy_endpoints: int
    degraded_endpoints: int
    down_endpoints: int
    unknown_endpoints: int
    active_incidents: int
    total_checks_24h: int
    success_rate_24h: float | None
    avg_latency_24h: float | None


class EndpointAnalytics(BaseModel):
    """Analytics for a specific endpoint."""

    endpoint_id: uuid.UUID
    name: str
    url: str
    checks_24h: int
    success_rate: float | None
    avg_latency_ms: float | None
    p95_latency_ms: float | None
    error_rate: float | None
    downtime_minutes: float | None
