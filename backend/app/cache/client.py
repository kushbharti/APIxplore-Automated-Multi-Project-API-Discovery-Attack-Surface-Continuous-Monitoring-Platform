"""
app/cache/client.py
====================
Redis client singleton with connection management.

Design:
- Uses redis.asyncio for async operations.
- CacheUnavailableError raised if Redis is unreachable — caller decides
  whether to continue without cache (graceful degradation).
- check_redis_health() used by /health/ready — never raises.
"""

from __future__ import annotations

import structlog
from redis.asyncio import Redis
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError

from app.core.config import get_settings
from app.core.exceptions import CacheTimeoutError, CacheUnavailableError

logger = structlog.get_logger(__name__)

_redis_client: Redis | None = None


def get_redis_client() -> Redis:
    """Return the singleton Redis client, creating it on first call."""
    global _redis_client  # noqa: PLW0603
    if _redis_client is None:
        settings = get_settings()
        _redis_client = Redis.from_url(
            settings.redis_url_str,
            password=settings.redis_password or None,
            socket_timeout=settings.redis_socket_timeout,
            socket_connect_timeout=settings.redis_connect_timeout,
            max_connections=settings.redis_max_connections,
            decode_responses=True,
        )
    return _redis_client


async def check_redis_health() -> bool:
    """Ping Redis. Returns False (not raises) if unavailable."""
    try:
        client = get_redis_client()
        await client.ping()
        return True
    except Exception:
        logger.warning("redis_health_check_failed")
        return False


async def close_redis() -> None:
    """Close the Redis connection pool gracefully."""
    global _redis_client  # noqa: PLW0603
    if _redis_client is not None:
        await _redis_client.aclose()
        logger.info("redis_connection_closed")
        _redis_client = None


async def safe_get(key: str) -> str | None:
    """
    Get a value from Redis, translating Redis exceptions to domain exceptions.

    Raises:
        CacheUnavailableError: If Redis is unreachable.
        CacheTimeoutError: If the operation times out.
    """
    try:
        return await get_redis_client().get(key)
    except RedisTimeoutError as exc:
        raise CacheTimeoutError() from exc
    except RedisConnectionError as exc:
        raise CacheUnavailableError() from exc


async def safe_set(key: str, value: str, ex: int | None = None) -> None:
    """
    Set a value in Redis with optional TTL.

    Raises:
        CacheUnavailableError: If Redis is unreachable.
    """
    try:
        await get_redis_client().set(key, value, ex=ex)
    except RedisTimeoutError as exc:
        raise CacheTimeoutError() from exc
    except RedisConnectionError as exc:
        raise CacheUnavailableError() from exc


async def safe_delete(key: str) -> None:
    """Delete a key from Redis."""
    try:
        await get_redis_client().delete(key)
    except (RedisConnectionError, RedisTimeoutError):
        pass  # Best-effort deletion — log but don't raise


async def safe_exists(key: str) -> bool:
    """Check if a key exists in Redis."""
    try:
        result = await get_redis_client().exists(key)
        return bool(result)
    except (RedisConnectionError, RedisTimeoutError):
        return False


async def acquire_lock(lock_key: str, ttl_seconds: int = 30) -> bool:
    """
    Acquire a distributed lock using Redis SET NX.

    Returns True if the lock was acquired, False if already held.
    Used by monitoring workers to prevent duplicate checks.
    """
    try:
        result = await get_redis_client().set(
            lock_key, "1", nx=True, ex=ttl_seconds
        )
        return result is not None
    except (RedisConnectionError, RedisTimeoutError):
        # If Redis is unavailable, allow the check to proceed (no lock)
        return True


async def release_lock(lock_key: str) -> None:
    """Release a distributed lock."""
    await safe_delete(lock_key)
