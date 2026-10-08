"""
app/monitoring/diagnosis.py
============================
Deterministic failure classification engine.

Combines HTTP status, exception type, latency, and recent check patterns
to produce a FailureClassification — NO AI/ML involved.
"""

from __future__ import annotations

from app.monitoring.states import FailureClassification


def classify_failure(
    *,
    status_code: int | None = None,
    latency_ms: float | None = None,
    failure_reason: str | None = None,
    error_detail: str | None = None,
    latency_threshold_ms: int = 2000,
    timeout_ms: int = 5000,
) -> FailureClassification:
    """
    Deterministic classification of a single health check failure.

    Rule priority (highest first):
    1. Timeout → TIMEOUT
    2. Connection/DNS → EXTERNAL_SERVICE_FAILURE
    3. 5xx → APPLICATION_FAILURE
    4. Database keywords in error → DATABASE_FAILURE
    5. Redis keywords → REDIS_FAILURE
    6. High latency only → HIGH_LATENCY
    7. Default → UNKNOWN
    """
    reason = (failure_reason or "").upper()
    detail = (error_detail or "").lower()

    # Timeout
    if "timeout" in reason or "timeout" in detail:
        return FailureClassification.TIMEOUT

    # Connection failure
    if any(k in reason for k in ("CONNECT", "CONNECTION", "DNS", "NETWORK")):
        return FailureClassification.EXTERNAL_SERVICE_FAILURE
    if any(k in detail for k in ("connection refused", "name resolution", "network")):
        return FailureClassification.EXTERNAL_SERVICE_FAILURE

    # Database failure
    if any(k in detail for k in ("postgresql", "asyncpg", "sqlalchemy", "database", "pg ")):
        return FailureClassification.DATABASE_FAILURE

    # Redis failure
    if any(k in detail for k in ("redis", "cache")):
        return FailureClassification.REDIS_FAILURE

    # 5xx application failure
    if status_code and 500 <= status_code < 600:
        return FailureClassification.APPLICATION_FAILURE

    # 4xx — not typically a service failure, but record it
    if status_code and 400 <= status_code < 500:
        return FailureClassification.APPLICATION_FAILURE

    # High latency without failure
    if latency_ms and latency_ms > latency_threshold_ms:
        return FailureClassification.HIGH_LATENCY

    return FailureClassification.UNKNOWN


def determine_severity(
    failure_type: FailureClassification,
    consecutive_failures: int,
    error_rate: float,
) -> str:
    """Determine incident severity from failure characteristics."""
    from app.models.incident import IncidentSeverity

    if failure_type == FailureClassification.DATABASE_FAILURE:
        return IncidentSeverity.CRITICAL.value
    if consecutive_failures >= 5 or error_rate > 0.8:
        return IncidentSeverity.CRITICAL.value
    if consecutive_failures >= 3 or error_rate > 0.5:
        return IncidentSeverity.HIGH.value
    if consecutive_failures >= 2 or error_rate > 0.2:
        return IncidentSeverity.MEDIUM.value
    return IncidentSeverity.LOW.value
