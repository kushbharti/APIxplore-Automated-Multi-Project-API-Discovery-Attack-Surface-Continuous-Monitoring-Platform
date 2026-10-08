"""
app/models/endpoint.py
=======================
Endpoint model — represents a monitored API endpoint.

Extended from the original model to support:
- Project association (project_id FK)
- Discovery metadata (source, confidence, path)
- Per-endpoint interval scheduling (last_checked_at)
"""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class HttpMethod(str, enum.Enum):
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    PATCH = "PATCH"
    DELETE = "DELETE"
    HEAD = "HEAD"
    OPTIONS = "OPTIONS"


class HealthState(str, enum.Enum):
    """Endpoint health states — used in the state machine."""
    UNKNOWN = "UNKNOWN"
    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    DOWN = "DOWN"
    RECOVERING = "RECOVERING"


class DiscoverySource(str, enum.Enum):
    """How this endpoint was discovered."""
    OPENAPI = "OPENAPI"
    CRAWLER = "CRAWLER"
    JAVASCRIPT = "JAVASCRIPT"
    MANUAL = "MANUAL"


class DiscoveryConfidence(str, enum.Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class Endpoint(UUIDMixin, TimestampMixin, Base):
    """
    A monitored API endpoint.

    Table: endpoints
    """

    __tablename__ = "endpoints"

    # --- Project association ---
    project_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # HTTP config
    method: Mapped[str] = mapped_column(
        String(10), nullable=False, default=HttpMethod.GET.value
    )
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    path: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    expected_status: Mapped[int] = mapped_column(Integer, nullable=False, default=200)

    # Monitoring thresholds
    timeout_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=5000)
    check_interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    failure_threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    latency_threshold_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=2000)

    # State
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    health_state: Mapped[str] = mapped_column(
        String(20), nullable=False, default=HealthState.UNKNOWN.value, index=True
    )

    # Discovery metadata
    discovery_source: Mapped[str] = mapped_column(
        String(20), nullable=False, default=DiscoverySource.MANUAL.value
    )
    confidence: Mapped[str] = mapped_column(
        String(10), nullable=False, default=DiscoveryConfidence.HIGH.value
    )

    # Scheduling
    last_checked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Tags / labels (comma-separated, simple approach)
    tags: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Relationships
    project: Mapped["Project | None"] = relationship(  # noqa: F821
        "Project", back_populates="endpoints", lazy="noload",
        foreign_keys=[project_id],
    )
    health_checks: Mapped[list["HealthCheck"]] = relationship(  # noqa: F821
        "HealthCheck", back_populates="endpoint", lazy="noload"
    )
    incidents: Mapped[list["Incident"]] = relationship(  # noqa: F821
        "Incident", back_populates="endpoint", lazy="noload"
    )

    def __repr__(self) -> str:
        return f"Endpoint(id={self.id!s}, name={self.name!r}, state={self.health_state!r})"
