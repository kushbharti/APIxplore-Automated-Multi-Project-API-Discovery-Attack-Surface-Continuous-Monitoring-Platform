"""
app/cache/policies.py
======================
Cache policies per resource type.

Priority levels:
    CRITICAL — profile, account status (always cache, short TTL)
    HIGH     — notifications, recent orders (medium TTL)
    MEDIUM   — recommendations, recent activity
    LOW      — historical reports, large analytics

Policy fields:
    ttl_seconds       — how long data is "fresh"
    max_stale_seconds — how long stale data may be served as fallback
    fallback_enabled  — whether stale data may be returned during outage
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CachePolicy:
    resource: str
    priority: str
    ttl_seconds: int
    max_stale_seconds: int
    fallback_enabled: bool


# Registry of all cacheable resources
_POLICIES: dict[str, CachePolicy] = {
    "profile": CachePolicy(
        resource="profile",
        priority="critical",
        ttl_seconds=300,       # 5 min fresh
        max_stale_seconds=3600,  # 1 hr stale fallback
        fallback_enabled=True,
    ),
    "account_status": CachePolicy(
        resource="account_status",
        priority="critical",
        ttl_seconds=60,
        max_stale_seconds=900,
        fallback_enabled=True,
    ),
    "notifications": CachePolicy(
        resource="notifications",
        priority="high",
        ttl_seconds=300,
        max_stale_seconds=900,
        fallback_enabled=True,
    ),
    "orders": CachePolicy(
        resource="orders",
        priority="high",
        ttl_seconds=300,
        max_stale_seconds=900,
        fallback_enabled=True,
    ),
    "recommendations": CachePolicy(
        resource="recommendations",
        priority="medium",
        ttl_seconds=600,
        max_stale_seconds=1800,
        fallback_enabled=True,
    ),
    "recent_activity": CachePolicy(
        resource="recent_activity",
        priority="medium",
        ttl_seconds=120,
        max_stale_seconds=600,
        fallback_enabled=True,
    ),
    "historical_reports": CachePolicy(
        resource="historical_reports",
        priority="low",
        ttl_seconds=3600,
        max_stale_seconds=7200,
        fallback_enabled=False,  # Too risky to serve stale historical data
    ),
}


def get_policy(resource: str) -> CachePolicy | None:
    """Return the cache policy for a resource, or None if not cacheable."""
    return _POLICIES.get(resource)


def list_policies() -> list[CachePolicy]:
    """Return all registered cache policies."""
    return list(_POLICIES.values())
