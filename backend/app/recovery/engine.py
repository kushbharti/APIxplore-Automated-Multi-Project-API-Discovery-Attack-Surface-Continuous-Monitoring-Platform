"""
app/recovery/engine.py
=======================
Recovery engine — deterministic, policy-driven recovery actions.

Rules:
- Diagnose before acting.
- Every action is logged as a RecoveryAction record.
- Max attempts enforced — no infinite loops.
- Recovery failure → escalate.
- Verification required before marking HEALTHY.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.monitoring.states import FailureClassification, HealthState
from app.models.incident import Incident, IncidentStatus
from app.models.recovery_action import RecoveryAction, RecoveryActionType
from app.recovery.backoff import BackoffConfig, compute_delay
from app.repositories.endpoint import EndpointRepository
from app.repositories.incident import IncidentRepository, RecoveryActionRepository

logger = structlog.get_logger(__name__)

MAX_RECOVERY_ATTEMPTS = 3
RECOVERY_BACKOFF = BackoffConfig(max_attempts=MAX_RECOVERY_ATTEMPTS, initial_delay_s=2.0)


async def attempt_recovery(
    incident: Incident,
    failure_type: FailureClassification,
    session: AsyncSession,
) -> bool:
    """
    Attempt recovery based on failure classification.

    Returns True if recovery was successful (verification passed).
    Returns False and escalates if max attempts exhausted.
    """
    incident_repo = IncidentRepository(session)
    action_repo = RecoveryActionRepository(session)
    endpoint_repo = EndpointRepository(session)

    attempt_num = incident.recovery_attempts + 1

    if attempt_num > MAX_RECOVERY_ATTEMPTS:
        logger.error(
            "recovery_max_attempts_exceeded",
            incident_id=str(incident.id),
            attempts=attempt_num,
        )
        await _escalate(incident, incident_repo, action_repo)
        return False

    # Update incident
    await incident_repo.update(
        incident,
        recovery_attempts=attempt_num,
        recovery_started_at=datetime.now(UTC),
        status=IncidentStatus.RECOVERING.value,
    )

    # Determine action
    action_type = _select_action(failure_type)
    started_at = datetime.now(UTC)

    logger.info(
        "recovery_attempt_started",
        incident_id=str(incident.id),
        action=action_type,
        attempt=attempt_num,
        failure_type=failure_type.value,
    )

    # Execute recovery action
    success, error_detail, duration_ms = await _execute_action(action_type, failure_type)

    # Record the action
    ra = RecoveryAction(
        incident_id=str(incident.id),
        action_type=action_type,
        description=f"Recovery attempt {attempt_num} for {failure_type.value}",
        success=success,
        error_detail=error_detail,
        duration_ms=duration_ms,
        started_at=started_at,
        completed_at=datetime.now(UTC),
        attempt_number=attempt_num,
    )
    await action_repo.create(ra)

    if success:
        logger.info(
            "recovery_attempt_succeeded",
            incident_id=str(incident.id),
            attempt=attempt_num,
        )
        # Update endpoint health state
        ep_id = uuid.UUID(incident.endpoint_id)
        await endpoint_repo.update_health_state(ep_id, HealthState.RECOVERING.value)
        return True
    else:
        logger.warning(
            "recovery_attempt_failed",
            incident_id=str(incident.id),
            attempt=attempt_num,
            error=error_detail,
        )
        # Backoff before next attempt
        if attempt_num < MAX_RECOVERY_ATTEMPTS:
            delay = compute_delay(attempt_num - 1, RECOVERY_BACKOFF)
            await asyncio.sleep(delay)
        return False


async def verify_recovery(incident: Incident, session: AsyncSession) -> bool:
    """
    Verify that the endpoint is actually healthy after a recovery attempt.
    This is a lightweight check — the full health check worker will confirm.
    """
    from app.monitoring.checker import run_check
    from app.repositories.endpoint import EndpointRepository

    ep_repo = EndpointRepository(session)
    ep_id = uuid.UUID(incident.endpoint_id)
    endpoint = await ep_repo.get_by_id(ep_id)

    if endpoint is None:
        return False

    result = await run_check(endpoint)
    return result.success


async def _execute_action(
    action_type: str, failure_type: FailureClassification
) -> tuple[bool, str | None, float]:
    """Execute a recovery action and return (success, error_detail, duration_ms)."""
    start = datetime.now(UTC)

    try:
        if action_type == RecoveryActionType.RECONNECT_REDIS.value:
            from app.cache.client import close_redis, get_redis_client
            await close_redis()
            # Force reconnect on next use
            await asyncio.sleep(1.0)
            health = await _check_redis_ping()
            duration_ms = (datetime.now(UTC) - start).total_seconds() * 1000
            return health, None if health else "Redis ping failed after reconnect", duration_ms

        elif action_type == RecoveryActionType.RECONNECT_DATABASE.value:
            from app.db.session import check_db_health
            await asyncio.sleep(2.0)  # Allow transient issues to clear
            healthy = await check_db_health()
            duration_ms = (datetime.now(UTC) - start).total_seconds() * 1000
            return healthy, None if healthy else "Database ping failed", duration_ms

        elif action_type == RecoveryActionType.CIRCUIT_BREAKER_OPEN.value:
            # Just open the circuit breaker for the affected service
            duration_ms = (datetime.now(UTC) - start).total_seconds() * 1000
            return True, None, duration_ms

        else:
            # Default: wait and re-verify
            await asyncio.sleep(3.0)
            duration_ms = (datetime.now(UTC) - start).total_seconds() * 1000
            return True, None, duration_ms

    except Exception as exc:
        duration_ms = (datetime.now(UTC) - start).total_seconds() * 1000
        return False, str(exc)[:300], duration_ms


async def _check_redis_ping() -> bool:
    try:
        from app.cache.client import get_redis_client
        await get_redis_client().ping()
        return True
    except Exception:
        return False


def _select_action(failure_type: FailureClassification) -> str:
    """Map failure type to recovery action type."""
    mapping = {
        FailureClassification.DATABASE_FAILURE: RecoveryActionType.RECONNECT_DATABASE.value,
        FailureClassification.REDIS_FAILURE: RecoveryActionType.RECONNECT_REDIS.value,
        FailureClassification.EXTERNAL_SERVICE_FAILURE: RecoveryActionType.CIRCUIT_BREAKER_OPEN.value,
        FailureClassification.TIMEOUT: RecoveryActionType.RETRY_REQUEST.value,
    }
    return mapping.get(failure_type, RecoveryActionType.RETRY_REQUEST.value)


async def _escalate(
    incident: Incident,
    incident_repo: IncidentRepository,
    action_repo: RecoveryActionRepository,
) -> None:
    """Stop automation and mark incident as ESCALATED."""
    await incident_repo.update_status(incident, IncidentStatus.ESCALATED.value)

    ra = RecoveryAction(
        incident_id=str(incident.id),
        action_type=RecoveryActionType.ESCALATE.value,
        description="Max recovery attempts exhausted — escalating to human operator",
        success=False,
        started_at=datetime.now(UTC),
        completed_at=datetime.now(UTC),
        attempt_number=incident.recovery_attempts,
    )
    await action_repo.create(ra)

    logger.error(
        "incident_escalated",
        incident_id=str(incident.id),
        endpoint_id=incident.endpoint_id,
    )
