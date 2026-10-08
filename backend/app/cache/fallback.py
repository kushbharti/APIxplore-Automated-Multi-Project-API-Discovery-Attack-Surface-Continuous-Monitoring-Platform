"""
app/cache/fallback.py
======================
Graceful degradation — serve stale cached data when primary source fails.

Response format always clearly indicates:
    status: "degraded"
    source: "cache"
    stale: true/false
    cached_at: <timestamp>

Never silently present stale data as live data.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.cache.policies import CachePolicy


@dataclass
class FallbackResult:
    """Result of a cache fallback lookup."""
    data: Any
    stale: bool
    cached_at: datetime
    policy: CachePolicy

    def to_response_dict(self) -> dict:
        """
        Format as a degraded API response.

        Always clearly communicates that data came from cache.
        """
        return {
            "status": "degraded",
            "source": "cache",
            "stale": self.stale,
            "cached_at": self.cached_at.isoformat(),
            "priority": self.policy.priority,
            "data": self.data,
        }
