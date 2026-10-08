"""
app/workers/monitor.py
=======================
Async monitoring worker — periodically checks all active endpoints.

Workflow per check cycle:
1. Fetch active endpoints from DB
2. Acquire distributed Redis lock (prevent duplicate checks in multi-worker)
3. Execute HTTP health check
4. Persist HealthCheck record
5. Evaluate health state via rolling window
6. Update endpoint state if changed
7. Handle incidents (create/deduplicate)
8. Release lock

Uses APScheduler for scheduling, runs within the FastAPI process.
"""

from __future__ import annotations

import asyncio
import socket
import uuid
from datetime import UTC, datetime

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.client import acquire_lock, release_lock
from app.cache.keys import CacheKeyBuilder
from app.db.session import get_session_factory
from app.incidents.manager import IncidentManager
from app.models.endpoint import HealthState
from app.models.health_check import HealthCheck
from app.monitoring.checker import run_check
from app.monitoring.evaluator import evaluate_health
from app.monitoring.states import HealthState as StateEnum
from app.observability.metrics import (
    ENDPOINT_CHECK_TOTAL,
    ENDPOINT_HEALTH_STATE,
    ENDPOINT_LATENCY_SECONDS,
)
from app.repositories.endpoint import EndpointRepository, HealthCheckRepository

logger = structlog.get_logger(__name__)

# Worker ID for logging (hostname-based)
WORKER_ID = f"worker-{socket.gethostname()}"


async def check_single_endpoint(endpoint_id_str: str) -> None:
    """
    Perform one health check cycle for a single endpoint.

    Each invocation uses its own DB session (unit of work).
    """
    structlog.contextvars.bind_contextvars(endpoint_id=endpoint_id_str)
    lock_key = CacheKeyBuilder.monitor_lock(endpoint_id_str)

    # Try to acquire distributed lock — skip if another worker is already checking
    lock_acquired = await acquire_lock(lock_key, ttl_seconds=30)
    if not lock_acquired:
        logger.debug("monitor_lock_held_skipping", endpoint_id=endpoint_id_str)
        return

    try:
        factory = get_session_factory()
        async with factory() as session:
            await _do_check(endpoint_id_str, session)
            await session.commit()
    except Exception:
        logger.exception("monitor_check_error", endpoint_id=endpoint_id_str)
    finally:
        await release_lock(lock_key)
        structlog.contextvars.unbind_contextvars("endpoint_id")


async def _do_check(endpoint_id_str: str, session: AsyncSession) -> None:
    ep_repo = EndpointRepository(session)
    hc_repo = HealthCheckRepository(session)
    incident_mgr = IncidentManager(session)

    ep_id = uuid.UUID(endpoint_id_str)
    endpoint = await ep_repo.get_by_id(ep_id)
    if endpoint is None or not endpoint.enabled:
        return

    # Execute HTTP check
    result = await run_check(endpoint)

    # Persist result
    hc = HealthCheck(
        endpoint_id=endpoint_id_str,
        checked_at=datetime.now(UTC),
        status_code=result.status_code,
        latency_ms=result.latency_ms,
        success=result.success,
        failure_reason=result.failure_reason,
        error_detail=result.error_detail,
        worker_id=WORKER_ID,
        response_body=result.response_body,
        response_headers=result.response_headers,
        content_type=result.content_type,
        response_size_bytes=result.response_size_bytes,
    )
    await hc_repo.create(hc)


    # Record Prometheus metrics
    ENDPOINT_CHECK_TOTAL.labels(
        endpoint_name=endpoint.name, success=str(result.success)
    ).inc()
    if result.latency_ms:
        ENDPOINT_LATENCY_SECONDS.labels(endpoint_name=endpoint.name).observe(
            result.latency_ms / 1000.0
        )

    # Evaluate rolling window
    recent = await hc_repo.get_recent(ep_id, limit=20)
    evaluation = evaluate_health(endpoint, recent)
    new_state = evaluation.new_state

    # Update state if changed
    if new_state.value != endpoint.health_state:
        await ep_repo.update_health_state(ep_id, new_state.value)
        logger.info(
            "endpoint_state_changed",
            endpoint_id=endpoint_id_str,
            from_state=endpoint.health_state,
            to_state=new_state.value,
            reason=evaluation.reason,
        )

    ENDPOINT_HEALTH_STATE.labels(endpoint_name=endpoint.name).set(
        1 if new_state == StateEnum.HEALTHY else 0
    )

    # Handle failure → incident
    if not result.success and new_state in (StateEnum.DEGRADED, StateEnum.DOWN):
        await incident_mgr.handle_failure(
            endpoint_id=ep_id,
            failure_classification=result.failure_classification,
            failure_reason=result.failure_reason or "UNKNOWN",
            metrics=evaluation.metrics,
        )

    # Handle recovery → resolve incident
    if new_state == StateEnum.HEALTHY:
        await incident_mgr.auto_resolve_if_healthy(ep_id, new_state)


async def _monitoring_cycle() -> None:
    """One full monitoring cycle — check all active endpoints."""
    try:
        factory = get_session_factory()
        async with factory() as session:
            repo = EndpointRepository(session)
            endpoints = await repo.get_due_for_check()

        if not endpoints:
            return

        # Run checks concurrently (bounded concurrency to avoid overloading)
        semaphore = asyncio.Semaphore(10)

        async def _bounded_check(ep_id: str) -> None:
            async with semaphore:
                await check_single_endpoint(ep_id)

        tasks = [_bounded_check(str(ep.id)) for ep in endpoints]
        await asyncio.gather(*tasks, return_exceptions=True)

    except Exception:
        logger.exception("monitoring_cycle_error")


def create_scheduler() -> AsyncIOScheduler:
    """
    Create and configure the APScheduler instance.

    Called from app lifespan — scheduler is started on app startup
    and shut down on app shutdown.
    """
    from app.core.config import get_settings

    settings = get_settings()
    scheduler = AsyncIOScheduler(timezone="UTC")
    scheduler.add_job(
        _monitoring_cycle,
        trigger="interval",
        seconds=settings.monitor_poll_interval_seconds,
        id="monitoring_worker",
        replace_existing=True,
        max_instances=1,  # Never run two cycles simultaneously
    )
    return scheduler
