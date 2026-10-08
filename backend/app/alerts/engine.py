"""
app/alerts/engine.py
=====================
Alert engine — fires alerts for incidents with deduplication and cooldowns.

Deduplication: same rule + endpoint within cooldown window → suppress.
Severity routing: CRITICAL alerts bypass cooldown.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alert_event import AlertEvent, AlertSeverity
from app.models.incident import Incident, IncidentSeverity
from app.repositories.incident import AlertEventRepository

logger = structlog.get_logger(__name__)

DEFAULT_COOLDOWN_SECONDS = 3600  # 1 hour dedup window


async def fire_incident_alert(incident: Incident, session: AsyncSession) -> AlertEvent | None:
    """
    Fire an alert for a new incident (if not suppressed by dedup/cooldown).

    Returns the AlertEvent if fired, None if suppressed.
    """
    repo = AlertEventRepository(session)

    rule_name = f"incident_{incident.failure_type.lower()}"
    severity = _map_severity(incident.severity)
    dedup_key = _make_dedup_key(rule_name, incident.endpoint_id)

    # Check cooldown (skip for CRITICAL)
    if severity != AlertSeverity.CRITICAL.value:
        recent = await repo.get_recent_by_dedup_key(dedup_key, DEFAULT_COOLDOWN_SECONDS)
        if recent is not None:
            logger.debug(
                "alert_suppressed_cooldown",
                rule=rule_name,
                incident_id=str(incident.id),
            )
            return None

    alert = AlertEvent(
        incident_id=str(incident.id),
        rule_name=rule_name,
        severity=severity,
        title=f"[{severity}] {incident.title}",
        message=(
            f"Incident {incident.id!s} detected on endpoint {incident.endpoint_id}. "
            f"Type: {incident.failure_type}. Failures: {incident.failure_count}."
        ),
        dedup_key=dedup_key,
        notified=False,
    )
    created = await repo.create(alert)

    logger.warning(
        "alert_fired",
        alert_id=str(created.id),
        rule=rule_name,
        severity=severity,
        incident_id=str(incident.id),
    )

    # Attempt webhook delivery
    await _deliver_webhook(created, session)
    return created


async def fire_recovery_failed_alert(incident: Incident, session: AsyncSession) -> None:
    """Fire a CRITICAL alert when recovery exhausts all attempts."""
    repo = AlertEventRepository(session)
    dedup_key = _make_dedup_key("recovery_failed", incident.endpoint_id)

    alert = AlertEvent(
        incident_id=str(incident.id),
        rule_name="recovery_failed",
        severity=AlertSeverity.CRITICAL.value,
        title=f"[CRITICAL] Recovery failed — {incident.endpoint_id}",
        message=(
            f"All {incident.recovery_attempts} recovery attempts failed for incident "
            f"{incident.id!s}. Human intervention required."
        ),
        dedup_key=dedup_key,
        notified=False,
    )
    await repo.create(alert)
    logger.error("critical_alert_recovery_failed", incident_id=str(incident.id))


async def _deliver_webhook(alert: AlertEvent, session: AsyncSession) -> None:
    """
    Deliver alert via webhook if configured.

    Webhook URL is read from settings — if not configured, log-only.
    Architecture supports adding Slack/PagerDuty adapters here without
    changing the incident engine.
    """
    from app.core.config import get_settings

    settings = get_settings()
    # Webhook URL is optional — not configured in base .env.example
    webhook_url = getattr(settings, "alert_webhook_url", None)

    if not webhook_url:
        logger.info(
            "alert_no_webhook_configured",
            alert_id=str(alert.id),
            title=alert.title,
        )
        return

    import httpx
    payload = {
        "alert_id": str(alert.id),
        "severity": alert.severity,
        "title": alert.title,
        "message": alert.message,
        "timestamp": datetime.now(UTC).isoformat(),
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(webhook_url, json=payload)
        from app.repositories.incident import AlertEventRepository
        repo = AlertEventRepository(session)
        alert.notified = True
        alert.notified_at = datetime.now(UTC)
        alert.notification_channel = "webhook"
        await session.flush()
    except Exception as exc:
        logger.warning("alert_webhook_failed", exc=str(exc), alert_id=str(alert.id))


def _make_dedup_key(rule_name: str, endpoint_id: str) -> str:
    raw = f"{rule_name}:{endpoint_id}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def _map_severity(incident_severity: str) -> str:
    mapping = {
        IncidentSeverity.LOW.value: AlertSeverity.INFO.value,
        IncidentSeverity.MEDIUM.value: AlertSeverity.WARNING.value,
        IncidentSeverity.HIGH.value: AlertSeverity.ERROR.value,
        IncidentSeverity.CRITICAL.value: AlertSeverity.CRITICAL.value,
    }
    return mapping.get(incident_severity, AlertSeverity.WARNING.value)
