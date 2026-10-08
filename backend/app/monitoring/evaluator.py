"""
app/monitoring/evaluator.py
============================
Health state evaluator — uses rolling windows to determine health transitions.

Rules (all deterministic, threshold-driven):
1. Consecutive failures >= failure_threshold → DOWN
2. Error rate in window > 50% → DEGRADED (if not already DOWN)
3. Average latency > latency_threshold_ms → DEGRADED
4. 2+ consecutive successes from DEGRADED/RECOVERING → HEALTHY
5. No data → UNKNOWN
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass

from app.models.endpoint import Endpoint
from app.models.health_check import HealthCheck
from app.monitoring.states import HealthState


@dataclass
class EvaluationResult:
    new_state: HealthState
    reason: str
    metrics: dict


def evaluate_health(
    endpoint: Endpoint,
    recent_checks: list[HealthCheck],
    window_size: int = 10,
) -> EvaluationResult:
    """
    Evaluate endpoint health from recent check results.

    Args:
        endpoint: The endpoint configuration (thresholds).
        recent_checks: List of recent checks ordered newest-first.
        window_size: How many checks to consider for rolling metrics.

    Returns:
        EvaluationResult with the recommended new state and reason.
    """
    current_state = HealthState(endpoint.health_state)

    if not recent_checks:
        return EvaluationResult(
            new_state=HealthState.UNKNOWN,
            reason="No health checks recorded yet",
            metrics={},
        )

    window = recent_checks[:window_size]
    total = len(window)
    failures = sum(1 for c in window if not c.success)
    successes = total - failures
    error_rate = failures / total if total > 0 else 0.0

    latencies = [c.latency_ms for c in window if c.latency_ms is not None]
    avg_latency = statistics.mean(latencies) if latencies else 0.0
    p95_latency = (
        sorted(latencies)[int(len(latencies) * 0.95)] if len(latencies) >= 5 else avg_latency
    )

    # Count consecutive failures/successes from the most recent
    consecutive_failures = 0
    for c in recent_checks:
        if not c.success:
            consecutive_failures += 1
        else:
            break

    consecutive_successes = 0
    for c in recent_checks:
        if c.success:
            consecutive_successes += 1
        else:
            break

    metrics = {
        "total_in_window": total,
        "failures": failures,
        "successes": successes,
        "error_rate": round(error_rate, 3),
        "avg_latency_ms": round(avg_latency, 1),
        "p95_latency_ms": round(p95_latency, 1),
        "consecutive_failures": consecutive_failures,
        "consecutive_successes": consecutive_successes,
    }

    # --- State machine rules ---

    # Rule 1: Consecutive failures → DOWN
    if consecutive_failures >= endpoint.failure_threshold:
        return EvaluationResult(
            new_state=HealthState.DOWN,
            reason=f"{consecutive_failures} consecutive failures (threshold: {endpoint.failure_threshold})",
            metrics=metrics,
        )

    # Rule 2: High error rate → DEGRADED
    if error_rate > 0.5 and total >= 3:
        return EvaluationResult(
            new_state=HealthState.DEGRADED,
            reason=f"Error rate {error_rate:.0%} in last {total} checks",
            metrics=metrics,
        )

    # Rule 3: High latency → DEGRADED
    if p95_latency > endpoint.latency_threshold_ms and len(latencies) >= 3:
        return EvaluationResult(
            new_state=HealthState.DEGRADED,
            reason=f"P95 latency {p95_latency:.0f}ms exceeds threshold {endpoint.latency_threshold_ms}ms",
            metrics=metrics,
        )

    # Rule 4: Recovery from DEGRADED/RECOVERING/DOWN → HEALTHY
    if consecutive_successes >= 2 and current_state in (
        HealthState.DEGRADED,
        HealthState.RECOVERING,
        HealthState.DOWN,
        HealthState.UNKNOWN,
    ):
        return EvaluationResult(
            new_state=HealthState.HEALTHY,
            reason=f"{consecutive_successes} consecutive successes",
            metrics=metrics,
        )

    # Rule 5: Steady healthy
    if consecutive_successes >= 1 and current_state == HealthState.HEALTHY:
        return EvaluationResult(
            new_state=HealthState.HEALTHY,
            reason="Continuing healthy",
            metrics=metrics,
        )

    # Rule 6: First success from UNKNOWN
    if consecutive_successes >= 1 and current_state == HealthState.UNKNOWN:
        return EvaluationResult(
            new_state=HealthState.HEALTHY,
            reason="First successful check",
            metrics=metrics,
        )

    # No change — return current state
    return EvaluationResult(
        new_state=current_state,
        reason="No threshold exceeded",
        metrics=metrics,
    )
