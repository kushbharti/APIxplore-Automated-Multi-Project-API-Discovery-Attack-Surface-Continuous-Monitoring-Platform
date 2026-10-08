"""
app/cache/keys.py
==================
Cache key builder — enforces strict user isolation.

Key format: user:{user_id}:{resource}:{priority}:v{version}

Examples:
    user:182:profile:critical:v1
    user:182:notifications:high:v1
    user:182:orders:high:v1

User identity is ALWAYS derived from authenticated context,
never from client-supplied parameters.
"""

from __future__ import annotations


class CacheKeyBuilder:
    """Generates structured cache keys with user isolation."""

    VERSION = 1  # Global cache version — increment to invalidate all keys

    @classmethod
    def user_resource(cls, user_id: str, resource: str, priority: str) -> str:
        """
        Build a user-scoped resource cache key.

        Args:
            user_id:  Authenticated user's UUID — from token, never from request body.
            resource: Resource name (e.g. 'profile', 'notifications').
            priority: Cache priority tier (e.g. 'critical', 'high').
        """
        return f"user:{user_id}:{resource}:{priority.lower()}:v{cls.VERSION}"

    @classmethod
    def circuit_breaker(cls, service: str) -> str:
        """Key for circuit breaker state."""
        return f"cb:{service}"

    @classmethod
    def monitor_lock(cls, endpoint_id: str) -> str:
        """Distributed lock key for monitoring worker."""
        return f"monitor:lock:endpoint:{endpoint_id}"

    @classmethod
    def health_state(cls, endpoint_id: str) -> str:
        """Short-lived runtime health state cache."""
        return f"health:state:{endpoint_id}"

    @classmethod
    def rate_limit(cls, user_id: str, route: str) -> str:
        """Rate limit counter key."""
        return f"ratelimit:{user_id}:{route}"
