"""
app/monitoring/states.py
=========================
Health state machine definitions.

State transitions (deterministic, policy-driven):
    UNKNOWN → HEALTHY (after N successful checks)
    HEALTHY → DEGRADED (latency/error threshold exceeded)
    DEGRADED → DOWN (repeated failures exceed threshold)
    DOWN → RECOVERING (recovery action started)
    RECOVERING → HEALTHY (recovery verified)
    RECOVERING → RECOVERY_FAILED (max attempts exhausted)
"""

from __future__ import annotations

from enum import Enum


class HealthState(str, Enum):
    UNKNOWN = "UNKNOWN"
    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    DOWN = "DOWN"
    RECOVERING = "RECOVERING"


# Allowed transitions: source → set of valid targets
VALID_TRANSITIONS: dict[HealthState, set[HealthState]] = {
    HealthState.UNKNOWN: {HealthState.HEALTHY, HealthState.DEGRADED, HealthState.DOWN},
    HealthState.HEALTHY: {HealthState.DEGRADED, HealthState.DOWN},
    HealthState.DEGRADED: {HealthState.HEALTHY, HealthState.DOWN},
    HealthState.DOWN: {HealthState.RECOVERING, HealthState.DEGRADED},
    HealthState.RECOVERING: {HealthState.HEALTHY, HealthState.DOWN, HealthState.DEGRADED},
}


def is_valid_transition(from_state: HealthState, to_state: HealthState) -> bool:
    """Return True if the state transition is allowed."""
    return to_state in VALID_TRANSITIONS.get(from_state, set())


class FailureClassification(str, Enum):
    """Deterministic failure categories from the diagnosis engine."""
    APPLICATION_FAILURE = "APPLICATION_FAILURE"
    DATABASE_FAILURE = "DATABASE_FAILURE"
    REDIS_FAILURE = "REDIS_FAILURE"
    EXTERNAL_SERVICE_FAILURE = "EXTERNAL_SERVICE_FAILURE"
    TIMEOUT = "TIMEOUT"
    HIGH_LATENCY = "HIGH_LATENCY"
    HIGH_ERROR_RATE = "HIGH_ERROR_RATE"
    CONNECTION_POOL_EXHAUSTION = "CONNECTION_POOL_EXHAUSTION"
    UNKNOWN = "UNKNOWN"
