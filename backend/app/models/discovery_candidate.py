"""
app/models/discovery_candidate.py
===================================
DiscoveryCandidate model — one discovered endpoint candidate from a discovery run.

Candidates are unverified potential endpoints found by the discovery engine.
After verification they become actual monitored endpoints.
"""

from __future__ import annotations

import enum

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class DiscoverySource(str, enum.Enum):
    """How this candidate was discovered."""
    OPENAPI = "OPENAPI"
    CRAWLER = "CRAWLER"
    JAVASCRIPT = "JAVASCRIPT"
    GITHUB = "GITHUB"
    MANUAL = "MANUAL"


class DiscoveryConfidence(str, enum.Enum):
    """Confidence that this is a real, usable endpoint."""
    HIGH = "HIGH"      # OpenAPI/Swagger — definitive
    MEDIUM = "MEDIUM"  # Found in JS code or HTML links
    LOW = "LOW"        # Guessed or inferred from patterns


class VerificationStatus(str, enum.Enum):
    """Result of the verification step (actual HTTP check)."""
    PENDING = "PENDING"
    VERIFIED = "VERIFIED"           # JSON/API response confirmed
    UNAVAILABLE = "UNAVAILABLE"     # Connected but returned error (404, 500, etc.)
    BLOCKED = "BLOCKED"             # SSRF blocked or connection refused
    INVALID = "INVALID"             # Not a valid HTTP endpoint at all
    SKIPPED = "SKIPPED"             # Verification not run
    WEB_PAGE = "WEB_PAGE"           # Returns HTML — is a webpage, not an API
    AUTH_REQUIRED = "AUTH_REQUIRED" # Returns 401/403 — endpoint exists but needs auth
    NOT_VERIFIED = "NOT_VERIFIED"   # Source-only discovery (e.g. GitHub without deployment URL)


class DiscoveryCandidate(UUIDMixin, TimestampMixin, Base):
    """
    A single endpoint candidate discovered during a discovery run.

    Table: discovery_candidates
    """

    __tablename__ = "discovery_candidates"

    run_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("discovery_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    project_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Endpoint identity
    method: Mapped[str] = mapped_column(String(10), nullable=False, default="GET")
    path: Mapped[str] = mapped_column(String(2048), nullable=False)
    full_url: Mapped[str] = mapped_column(String(2048), nullable=False)

    # Discovery metadata
    source: Mapped[str] = mapped_column(
        String(20), nullable=False, default=DiscoverySource.CRAWLER.value
    )
    confidence: Mapped[str] = mapped_column(
        String(10), nullable=False, default=DiscoveryConfidence.MEDIUM.value
    )

    # OpenAPI-specific metadata
    operation_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Verification results
    verification_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=VerificationStatus.PENDING.value
    )
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_time_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    verification_error: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Whether this candidate was accepted into the endpoint registry
    accepted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    endpoint_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), nullable=True
    )  # FK set when accepted (soft link)

    # Relationships
    run: Mapped["DiscoveryRun"] = relationship(  # noqa: F821
        "DiscoveryRun", back_populates="candidates", lazy="noload"
    )

    def __repr__(self) -> str:
        return (
            f"DiscoveryCandidate(method={self.method}, path={self.path!r}, "
            f"source={self.source!r}, status={self.verification_status!r})"
        )
