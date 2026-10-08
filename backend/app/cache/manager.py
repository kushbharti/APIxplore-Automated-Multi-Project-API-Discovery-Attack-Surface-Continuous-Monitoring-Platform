"""
app/cache/manager.py
=====================
Cache manager — read/write/invalidate user-specific cached resources.

Enforces:
- User isolation (keys include user_id from auth context)
- Policy compliance (only cacheable resources are stored)
- TTL and stale-data rules
- Metadata recording (cached_at, expires_at, version, priority)
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import structlog

from app.cache.client import safe_delete, safe_get, safe_set
from app.cache.keys import CacheKeyBuilder
from app.cache.policies import CachePolicy, get_policy
from app.core.exceptions import CacheUnavailableError, CacheTimeoutError

logger = structlog.get_logger(__name__)

MAX_CACHE_SIZE_BYTES = 512 * 1024  # 512 KB per entry limit


class CachedEntry:
    """Deserialized cache entry with freshness metadata."""

    def __init__(self, raw: dict) -> None:
        self.data: Any = raw.get("data")
        self.cached_at: datetime = datetime.fromisoformat(raw["cached_at"])
        self.expires_at: datetime = datetime.fromisoformat(raw["expires_at"])
        self.version: int = raw.get("version", 1)
        self.priority: str = raw.get("priority", "medium")

    @property
    def is_fresh(self) -> bool:
        return datetime.now(UTC) < self.expires_at

    @property
    def age_seconds(self) -> float:
        return (datetime.now(UTC) - self.cached_at).total_seconds()


class CacheManager:
    """
    Manages user-specific resource caching.

    All methods accept user_id from the authenticated session — NEVER
    from request parameters — ensuring user isolation.
    """

    async def get(
        self, user_id: str, resource: str
    ) -> CachedEntry | None:
        """
        Retrieve a cached entry for a user+resource.

        Returns None if:
        - No entry exists
        - Redis is unavailable (graceful degradation)
        - Entry is malformed
        """
        policy = get_policy(resource)
        if policy is None:
            return None

        key = CacheKeyBuilder.user_resource(user_id, resource, policy.priority)
        try:
            raw_json = await safe_get(key)
        except (CacheUnavailableError, CacheTimeoutError):
            logger.warning("cache_get_unavailable", user_id=user_id, resource=resource)
            return None

        if raw_json is None:
            return None

        try:
            return CachedEntry(json.loads(raw_json))
        except (json.JSONDecodeError, KeyError):
            logger.warning("cache_entry_malformed", user_id=user_id, resource=resource)
            return None

    async def set(
        self, user_id: str, resource: str, data: Any
    ) -> bool:
        """
        Cache a resource for a user.

        Returns True on success, False if policy not found or Redis unavailable.
        Enforces size limits to prevent large entries from polluting the cache.
        """
        policy = get_policy(resource)
        if policy is None:
            logger.debug("cache_skip_no_policy", resource=resource)
            return False

        now = datetime.now(UTC)
        expires_at = datetime.fromtimestamp(
            now.timestamp() + policy.ttl_seconds, tz=UTC
        )

        entry = {
            "data": data,
            "cached_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
            "version": CacheKeyBuilder.VERSION,
            "priority": policy.priority,
        }

        try:
            raw_json = json.dumps(entry, default=str)
        except (TypeError, ValueError):
            logger.warning("cache_serialization_failed", resource=resource)
            return False

        # Size guard
        if len(raw_json.encode()) > MAX_CACHE_SIZE_BYTES:
            logger.warning(
                "cache_entry_too_large",
                resource=resource,
                size_bytes=len(raw_json.encode()),
            )
            return False

        key = CacheKeyBuilder.user_resource(user_id, resource, policy.priority)
        # TTL includes stale period so key persists for fallback queries
        total_ttl = policy.ttl_seconds + policy.max_stale_seconds

        try:
            await safe_set(key, raw_json, ex=total_ttl)
            logger.debug("cache_set", user_id=user_id, resource=resource, ttl=total_ttl)
            return True
        except (CacheUnavailableError, CacheTimeoutError):
            logger.warning("cache_set_unavailable", user_id=user_id, resource=resource)
            return False

    async def invalidate(self, user_id: str, resource: str) -> None:
        """Remove a cached entry for a user+resource."""
        policy = get_policy(resource)
        if policy is None:
            return
        key = CacheKeyBuilder.user_resource(user_id, resource, policy.priority)
        await safe_delete(key)
        logger.info("cache_invalidated", user_id=user_id, resource=resource)

    async def get_for_fallback(
        self, user_id: str, resource: str
    ) -> "FallbackResult | None":
        """
        Try to retrieve data for graceful degradation (Phase 8).

        Checks both fresh and stale data according to the policy.
        Returns None if no usable data available.
        """
        from app.cache.fallback import FallbackResult

        policy = get_policy(resource)
        if policy is None or not policy.fallback_enabled:
            return None

        entry = await self.get(user_id, resource)
        if entry is None:
            return None

        if entry.is_fresh:
            return FallbackResult(data=entry.data, stale=False, cached_at=entry.cached_at, policy=policy)

        # Check max_stale
        if entry.age_seconds <= (policy.ttl_seconds + policy.max_stale_seconds):
            return FallbackResult(data=entry.data, stale=True, cached_at=entry.cached_at, policy=policy)

        # Too stale — do not serve
        return None
