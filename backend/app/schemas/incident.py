"""
app/schemas/incident.py
========================
Pydantic schemas for incident API responses.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class IncidentOut(BaseModel):
    """Full incident representation."""

    id: uuid.UUID
    endpoint_id: str
    title: str
    failure_type: str
    severity: str
    root_cause: str | None
    status: str
    failure_count: int
    recovery_attempts: int
    detected_at: datetime
    recovery_started_at: datetime | None
    resolved_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class IncidentSummary(BaseModel):
    """Compact incident for list views."""

    id: uuid.UUID
    endpoint_id: str
    title: str
    failure_type: str
    severity: str
    status: str
    failure_count: int
    detected_at: datetime
    resolved_at: datetime | None

    model_config = {"from_attributes": True}


class RecoveryActionOut(BaseModel):
    """Recovery action record."""

    id: uuid.UUID
    incident_id: str
    action_type: str
    description: str
    success: bool
    error_detail: str | None
    duration_ms: float | None
    started_at: datetime
    completed_at: datetime | None
    attempt_number: int

    model_config = {"from_attributes": True}


class AlertEventOut(BaseModel):
    """Alert event record."""

    id: uuid.UUID
    incident_id: str | None
    rule_name: str
    severity: str
    title: str
    message: str
    notified: bool
    notified_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class HealthCheckOut(BaseModel):
    """Health check result."""

    id: uuid.UUID
    endpoint_id: str
    checked_at: datetime
    status_code: int | None
    latency_ms: float | None
    success: bool
    failure_reason: str | None

    model_config = {"from_attributes": True}


class HealthCheckResponseOut(BaseModel):
    """
    Extended health check result including the captured response data.
    Used by GET /endpoints/{id}/latest-response.
    Sensitive headers are never stored, so they cannot be leaked here.
    """

    id: uuid.UUID
    endpoint_id: str
    checked_at: datetime
    status_code: int | None
    latency_ms: float | None
    success: bool
    failure_reason: str | None
    error_detail: str | None
    # Response capture fields (nullable — only populated when an HTTP response was received)
    response_body: str | None
    response_headers: str | None  # JSON string of safe response headers
    content_type: str | None
    response_size_bytes: int | None

    model_config = {"from_attributes": True}

