"""
app/incidents/manager.py
=========================
Incident lifecycle manager.

- Creates incidents from monitoring events (with deduplication).
- Drives lifecycle transitions.
- Triggers recovery engine and alerting.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.incident import Incident, IncidentSeverity, IncidentStatus
from app.monitoring.diagnosis import classify_failure, determine_severity
from app.monitoring.states import FailureClassification, HealthState
from app.repositories.endpoint import EndpointRepository
from app.repositories.incident import IncidentRepository

logger = structlog.get_logger(__name__)


class IncidentManager:
    def __init__(self, session: AsyncSession) -> None:
        self._repo = IncidentRepository(session)
        self._ep_repo = EndpointRepository(session)

    async def handle_failure(
        self,
        endpoint_id: uuid.UUID,
        failure_classification: FailureClassification,
        failure_reason: str,
        metrics: dict,
    ) -> Incident:
        """
        Handle a failure event from the monitoring worker.

        - If an active incident exists → increment failure_count (deduplication).
        - If no active incident → create a new one.
        - Trigger recovery if threshold exceeded.
        """
        existing = await self._repo.get_active_for_endpoint(endpoint_id)

        if existing:
            # Deduplicate — update existing incident
            await self._repo.increment_failures(existing)
            logger.info(
                "incident_failure_count_incremented",
                incident_id=str(existing.id),
                failure_count=existing.failure_count,
            )
            await self._trigger_recovery_if_needed(existing, failure_classification, metrics)
            return existing

        # Create new incident
        consecutive = metrics.get("consecutive_failures", 1)
        error_rate = metrics.get("error_rate", 0.0)
        severity = determine_severity(failure_classification, consecutive, error_rate)

        incident = Incident(
            endpoint_id=str(endpoint_id),
            title=f"{failure_classification.value} on endpoint",
            failure_type=failure_classification.value,
            severity=severity,
            status=IncidentStatus.DETECTED.value,
            detected_at=datetime.now(UTC),
            failure_count=1,
            recovery_attempts=0,
        )
        created = await self._repo.create(incident)

        logger.warning(
            "incident_created",
            incident_id=str(created.id),
            endpoint_id=str(endpoint_id),
            failure_type=failure_classification.value,
            severity=severity,
        )

        # Fire alert
        await self._fire_alert(created)
        await self._trigger_recovery_if_needed(created, failure_classification, metrics)
        return created

    async def resolve(self, incident_id: uuid.UUID) -> Incident | None:
        """Mark an incident as RESOLVED."""
        incident = await self._repo.get_by_id(incident_id)
        if incident is None:
            return None
        await self._repo.update_status(incident, IncidentStatus.RESOLVED.value)
        logger.info("incident_resolved", incident_id=str(incident_id))
        return incident

    async def auto_resolve_if_healthy(
        self, endpoint_id: uuid.UUID, new_state: HealthState
    ) -> None:
        """
        If the endpoint just became HEALTHY, resolve its active incident.
        Called by the monitoring worker after state evaluation.
        """
        if new_state != HealthState.HEALTHY:
            return

        existing = await self._repo.get_active_for_endpoint(endpoint_id)
        if existing and existing.status not in (
            IncidentStatus.RESOLVED.value,
            IncidentStatus.ESCALATED.value,
        ):
            await self._repo.update_status(existing, IncidentStatus.RESOLVED.value)
            logger.info(
                "incident_auto_resolved",
                incident_id=str(existing.id),
                endpoint_id=str(endpoint_id),
            )

    async def _trigger_recovery_if_needed(
        self,
        incident: Incident,
        failure_type: FailureClassification,
        metrics: dict,
    ) -> None:
        """Kick off recovery if this incident warrants it."""
        if incident.status in (
            IncidentStatus.RECOVERING.value,
            IncidentStatus.RESOLVED.value,
            IncidentStatus.ESCALATED.value,
        ):
            return  # Already being handled

        if incident.recovery_attempts >= 3:
            return  # Max attempts enforced elsewhere

        # Only auto-recover for certain severity levels
        if incident.severity in (IncidentSeverity.HIGH.value, IncidentSeverity.CRITICAL.value):
            from app.recovery.engine import attempt_recovery
            import asyncio

            # Fire-and-forget recovery (don't block the monitoring loop)
            # In production, this would be a proper background task queue
            asyncio.create_task(
                attempt_recovery(incident, failure_type, self._repo._session)
            )

    async def _fire_alert(self, incident: Incident) -> None:
        """Trigger alert creation for a new incident."""
        from app.alerts.engine import fire_incident_alert
        try:
            await fire_incident_alert(incident, self._repo._session)
        except Exception:
            logger.exception("alert_fire_failed", incident_id=str(incident.id))
