"""
app/models/alert_event.py
==========================
AlertEvent model — a triggered alert notification.

Alert events are created by the alert engine when rules fire.
Deduplication prevents duplicate alerts within the cooldown window.
"""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class AlertSeverity(str, enum.Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


class AlertEvent(UUIDMixin, TimestampMixin, Base):
    """
    A fired alert notification.

    Table: alert_events
    """

    __tablename__ = "alert_events"

    incident_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("incidents.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    rule_name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(
        String(20), nullable=False, default=AlertSeverity.WARNING.value
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)

    # Delivery
    notified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notification_channel: Mapped[str | None] = mapped_column(String(50), nullable=True)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Deduplication key (rule + endpoint combo within cooldown window)
    dedup_key: Mapped[str] = mapped_column(String(200), nullable=False, index=True)

    incident: Mapped["Incident | None"] = relationship(  # noqa: F821
        "Incident", back_populates="alert_events", lazy="noload"
    )

    def __repr__(self) -> str:
        return f"AlertEvent(rule={self.rule_name!r}, severity={self.severity!r})"
