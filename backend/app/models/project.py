"""
app/models/project.py
======================
Project model — top-level container for endpoint discovery and monitoring.

A project represents a target website or API. Users enter a URL, discovery
runs under the project, and monitored endpoints belong to this project.
"""

from __future__ import annotations

import enum

from sqlalchemy import Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class ProjectStatus(str, enum.Enum):
    """Overall health status of the project (derived from its endpoints)."""
    UNKNOWN = "UNKNOWN"
    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    DOWN = "DOWN"


class Project(UUIDMixin, TimestampMixin, Base):
    """
    A monitored project/API target.

    Table: projects
    """

    __tablename__ = "projects"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Source type — WEBSITE or GITHUB_REPOSITORY
    source_type: Mapped[str] = mapped_column(
        String(30), nullable=False, default="WEBSITE"
    )
    # Optional deployment URL for GitHub repos
    deployment_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)

    # Derived status (updated by monitoring worker)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=ProjectStatus.UNKNOWN.value, index=True
    )

    # Health score 0-100 (composite: availability, latency, error rate)
    health_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Counters (denormalized for fast dashboard queries)
    endpoint_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    healthy_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    degraded_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    down_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Relationships
    endpoints: Mapped[list["Endpoint"]] = relationship(  # noqa: F821
        "Endpoint", back_populates="project", lazy="noload",
        foreign_keys="Endpoint.project_id",
    )
    discovery_runs: Mapped[list["DiscoveryRun"]] = relationship(  # noqa: F821
        "DiscoveryRun", back_populates="project", lazy="noload"
    )

    def __repr__(self) -> str:
        return f"Project(id={self.id!s}, name={self.name!r}, url={self.url!r})"
