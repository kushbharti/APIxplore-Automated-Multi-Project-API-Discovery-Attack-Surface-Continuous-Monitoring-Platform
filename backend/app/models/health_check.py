"""
app/models/health_check.py
===========================
HealthCheck model — one record per HTTP health check execution.

Stores the raw result of every check: latency, status code, success/failure,
error details. The evaluator (Phase 4) reads recent checks to compute
rolling window metrics and drive state transitions.

Index strategy:
    (endpoint_id, checked_at DESC) — primary query pattern for recent checks
    (endpoint_id, success) — for error-rate calculations
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDMixin


class HealthCheck(UUIDMixin, Base):
    """
    Result of a single health check execution.

    Table: health_checks
    """

    __tablename__ = "health_checks"

    endpoint_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("endpoints.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    checked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )

    # HTTP result
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Failure detail
    failure_reason: Mapped[str | None] = mapped_column(String(100), nullable=True)
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Response capture (stored only for latest check — helps UI show actual response)
    # Body is truncated to 64 KB max before storage.
    # Sensitive headers (Authorization, Cookie, Set-Cookie) are NEVER stored.
    response_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_headers: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    content_type: Mapped[str | None] = mapped_column(String(200), nullable=True)
    response_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # What worker ran this check
    worker_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    endpoint: Mapped["Endpoint"] = relationship(  # noqa: F821
        "Endpoint", back_populates="health_checks", lazy="noload"
    )

    def __repr__(self) -> str:
        return (
            f"HealthCheck(endpoint={self.endpoint_id!r}, "
            f"success={self.success}, latency={self.latency_ms}ms)"
        )
