"""
app/models/discovery_run.py
============================
DiscoveryRun model — tracks one execution of the discovery engine for a project.

A discovery run goes through several stages:
  PENDING → RUNNING → COMPLETED | FAILED | PARTIAL

Each run stores aggregate statistics and links to its candidates.
"""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class DiscoveryStatus(str, enum.Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    PARTIAL = "PARTIAL"  # Some providers succeeded, some failed


class DiscoveryRun(UUIDMixin, TimestampMixin, Base):
    """
    One execution of the discovery engine for a project.

    Table: discovery_runs
    """

    __tablename__ = "discovery_runs"

    project_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Lifecycle
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=DiscoveryStatus.PENDING.value, index=True
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Discovery method flags
    openapi_checked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    crawl_checked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    js_checked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    github_checked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Results
    openapi_found: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    openapi_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    candidates_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    candidates_verified: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    candidates_unavailable: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    candidates_blocked: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Error info (if FAILED or PARTIAL)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Provider-level status (JSON-encoded summary)
    provider_results: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON

    # Real-time progress state
    progress_state: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON

    # Relationships
    project: Mapped["Project"] = relationship(  # noqa: F821
        "Project", back_populates="discovery_runs", lazy="noload"
    )
    candidates: Mapped[list["DiscoveryCandidate"]] = relationship(  # noqa: F821
        "DiscoveryCandidate", back_populates="run", lazy="noload"
    )

    def __repr__(self) -> str:
        return (
            f"DiscoveryRun(id={self.id!s}, project={self.project_id!r}, "
            f"status={self.status!r}, candidates={self.candidates_total})"
        )
