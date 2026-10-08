"""
app/models/incident.py
=======================
Incident model — represents a failure event and its full lifecycle.

Lifecycle states: DETECTED → INVESTIGATING → RECOVERING → VERIFIED → RESOLVED
Failure path:     DETECTING → RECOVERING → RECOVERY_FAILED → ESCALATED

One active incident per endpoint per failure type — deduplication prevents
creating a new incident for every failed request.
"""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class IncidentStatus(str, enum.Enum):
    DETECTED = "DETECTED"
    INVESTIGATING = "INVESTIGATING"
    RECOVERING = "RECOVERING"
    VERIFIED = "VERIFIED"
    RESOLVED = "RESOLVED"
    RECOVERY_FAILED = "RECOVERY_FAILED"
    ESCALATED = "ESCALATED"


class IncidentSeverity(str, enum.Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class Incident(UUIDMixin, TimestampMixin, Base):
    """
    A failure incident for a monitored endpoint.

    Table: incidents
    """

    __tablename__ = "incidents"

    endpoint_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("endpoints.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Classification
    failure_type: Mapped[str] = mapped_column(String(100), nullable=False)
    severity: Mapped[str] = mapped_column(
        String(20), nullable=False, default=IncidentSeverity.MEDIUM.value
    )
    root_cause: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Lifecycle
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default=IncidentStatus.DETECTED.value, index=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)

    # Timeline
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    recovery_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Counters
    failure_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    recovery_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    endpoint: Mapped["Endpoint"] = relationship(  # noqa: F821
        "Endpoint", back_populates="incidents", lazy="noload"
    )
    recovery_actions: Mapped[list["RecoveryAction"]] = relationship(  # noqa: F821
        "RecoveryAction", back_populates="incident", lazy="noload"
    )
    alert_events: Mapped[list["AlertEvent"]] = relationship(  # noqa: F821
        "AlertEvent", back_populates="incident", lazy="noload"
    )

    def __repr__(self) -> str:
        return f"Incident(id={self.id!s}, status={self.status!r}, type={self.failure_type!r})"
