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

# Matches GitHub repository URLs:  github.com/OWNER/REPO
# Matches GitHub profile URLs:      github.com/USERNAME  (with optional ?tab=...)
_GITHUB_URL_RE = re.compile(
    r"^https?://github\.com/[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)?/?(?:\?.*)?$",
    re.IGNORECASE,
)
# Legacy alias (kept for any code that imports this symbol)
_GITHUB_REPO_RE = _GITHUB_URL_RE


# ---------------------------------------------------------------------------
# Project schemas
# ---------------------------------------------------------------------------


class ProjectCreate(BaseModel):
    """Body for POST /api/v1/projects."""

    name: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=8, max_length=2048, description="Target website/API root URL or GitHub repository URL")
    description: str | None = Field(default=None, max_length=1000)
    source_type: Literal["WEBSITE", "GITHUB_REPOSITORY"] = "WEBSITE"
    deployment_url: str | None = Field(
        default=None,
        max_length=2048,
        description="For GitHub repos: the live deployment URL to verify discovered routes against",
    )

    @field_validator("url")
    @classmethod
    def validate_url_scheme(cls, v: str) -> str:
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("URL must start with http:// or https://")
        return v.rstrip("/")

    @field_validator("deployment_url")
    @classmethod
    def validate_deployment_url(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("Deployment URL must start with http:// or https://")
        return v.rstrip("/")


class ProjectUpdate(BaseModel):
    """Body for PATCH /api/v1/projects/{id}."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    url: str | None = Field(default=None, min_length=8, max_length=2048)
    description: str | None = None


class ProjectOut(BaseModel):
    """Project representation returned to API callers."""

    id: uuid.UUID
    name: str
    url: str
    description: str | None
    status: str
    health_score: float | None
    endpoint_count: int
    healthy_count: int
    degraded_count: int
    down_count: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectSummary(BaseModel):
    """Compact project representation for list views."""

    id: uuid.UUID
    name: str
    url: str
    status: str
    health_score: float | None
    endpoint_count: int
    healthy_count: int
    degraded_count: int
    down_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Discovery schemas
# ---------------------------------------------------------------------------


class DiscoveryRunOut(BaseModel):
    """Discovery run status."""

    id: uuid.UUID
    project_id: uuid.UUID
    status: str
    started_at: datetime | None
    completed_at: datetime | None
    openapi_checked: bool
    crawl_checked: bool
    js_checked: bool
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

    id: uuid.UUID
    run_id: uuid.UUID
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
    endpoint_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AcceptCandidatesRequest(BaseModel):
    """Body for POST /api/v1/discovery/{run_id}/accept."""

    candidate_ids: list[uuid.UUID] = Field(
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
