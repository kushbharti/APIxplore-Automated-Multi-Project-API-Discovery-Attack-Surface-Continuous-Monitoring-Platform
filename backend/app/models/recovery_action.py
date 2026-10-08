"""
app/models/recovery_action.py
==============================
RecoveryAction model — audit log of every recovery attempt.

Every recovery action taken by the recovery engine is recorded:
what action was taken, when, whether it succeeded, and how long it took.
This creates a full audit trail auditable by operators.
"""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class RecoveryActionType(str, enum.Enum):
    RETRY_REQUEST = "RETRY_REQUEST"
    RECONNECT_REDIS = "RECONNECT_REDIS"
    RECONNECT_DATABASE = "RECONNECT_DATABASE"
    CIRCUIT_BREAKER_OPEN = "CIRCUIT_BREAKER_OPEN"
    CIRCUIT_BREAKER_HALF_OPEN = "CIRCUIT_BREAKER_HALF_OPEN"
    CIRCUIT_BREAKER_CLOSE = "CIRCUIT_BREAKER_CLOSE"
    CACHE_FALLBACK = "CACHE_FALLBACK"
    VERIFY_RECOVERY = "VERIFY_RECOVERY"
    ESCALATE = "ESCALATE"
    MANUAL = "MANUAL"


class RecoveryAction(UUIDMixin, TimestampMixin, Base):
    """
    Audit record of a recovery action.

    Table: recovery_actions
    """

    __tablename__ = "recovery_actions"

    incident_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("incidents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    action_type: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)

    # Outcome
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Timeline
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    attempt_number: Mapped[int] = mapped_column(nullable=False, default=1)

    incident: Mapped["Incident"] = relationship(  # noqa: F821
        "Incident", back_populates="recovery_actions", lazy="noload"
    )

    def __repr__(self) -> str:
        return (
            f"RecoveryAction(type={self.action_type!r}, "
            f"success={self.success}, attempt={self.attempt_number})"
        )
