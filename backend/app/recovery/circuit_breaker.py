"""
app/recovery/circuit_breaker.py
================================
Circuit breaker stored in Redis for distributed state.

States: CLOSED → OPEN → HALF_OPEN → CLOSED (or back to OPEN)

CLOSED:    Normal operation — requests flow through.
OPEN:      Failures exceeded threshold — requests blocked for cooldown.
HALF_OPEN: Cooldown expired — allow one test request.
           Success → CLOSED; Failure → OPEN.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import structlog

from app.cache.client import get_redis_client, safe_get, safe_set
from app.cache.keys import CacheKeyBuilder

logger = structlog.get_logger(__name__)

OPEN_COOLDOWN_SECONDS = 60
HALF_OPEN_TEST_WINDOW = 30
FAILURE_THRESHOLD = 5


class CircuitBreakerState:
    CLOSED = "CLOSED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"


async def get_circuit_state(service: str) -> str:
    """Return the current circuit breaker state for a service."""
    key = CacheKeyBuilder.circuit_breaker(service)
    try:
        raw = await safe_get(key)
        if raw is None:
            return CircuitBreakerState.CLOSED
        data = json.loads(raw)
        state = data.get("state", CircuitBreakerState.CLOSED)

        # Check if OPEN cooldown has expired → transition to HALF_OPEN
        if state == CircuitBreakerState.OPEN:
            opened_at = datetime.fromisoformat(data.get("opened_at", datetime.now(UTC).isoformat()))
            age = (datetime.now(UTC) - opened_at).total_seconds()
            if age >= OPEN_COOLDOWN_SECONDS:
                await _set_state(service, CircuitBreakerState.HALF_OPEN)
                return CircuitBreakerState.HALF_OPEN

        return state
    except Exception:
        return CircuitBreakerState.CLOSED


async def record_success(service: str) -> None:
    """Record a successful call — close the circuit if in HALF_OPEN."""
    state = await get_circuit_state(service)
    if state == CircuitBreakerState.HALF_OPEN:
        await _set_state(service, CircuitBreakerState.CLOSED)
        logger.info("circuit_breaker_closed", service=service)
    elif state == CircuitBreakerState.CLOSED:
        # Reset failure counter
        await _reset_failures(service)


async def record_failure(service: str) -> str:
    """
    Record a failed call. Returns the new circuit state.

    HALF_OPEN + failure → OPEN (back off)
    CLOSED + failures >= threshold → OPEN
    """
    state = await get_circuit_state(service)

    if state == CircuitBreakerState.HALF_OPEN:
        await _set_state(service, CircuitBreakerState.OPEN)
        logger.warning("circuit_breaker_reopened", service=service)
        return CircuitBreakerState.OPEN

    failures = await _increment_failures(service)
    if failures >= FAILURE_THRESHOLD:
        await _set_state(service, CircuitBreakerState.OPEN)
        logger.warning("circuit_breaker_opened", service=service, failures=failures)
        return CircuitBreakerState.OPEN

    return CircuitBreakerState.CLOSED


async def _set_state(service: str, state: str) -> None:
    key = CacheKeyBuilder.circuit_breaker(service)
    data = {
        "state": state,
        "opened_at": datetime.now(UTC).isoformat() if state == CircuitBreakerState.OPEN else None,
    }
    await safe_set(key, json.dumps(data), ex=OPEN_COOLDOWN_SECONDS * 3)


async def _increment_failures(service: str) -> int:
    """Increment failure counter and return new count."""
    fail_key = f"{CacheKeyBuilder.circuit_breaker(service)}:failures"
    try:
        client = get_redis_client()
        count = await client.incr(fail_key)
        await client.expire(fail_key, OPEN_COOLDOWN_SECONDS * 2)
        return int(count)
    except Exception:
        return 0


async def _reset_failures(service: str) -> None:
    fail_key = f"{CacheKeyBuilder.circuit_breaker(service)}:failures"
    try:
        await get_redis_client().delete(fail_key)
    except Exception:
        pass
