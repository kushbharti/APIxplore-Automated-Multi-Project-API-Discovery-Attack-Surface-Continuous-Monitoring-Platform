"""
app/monitoring/checker.py
==========================
HTTP health checker — executes a single health check for an endpoint.

Uses httpx for async HTTP. Classifies failures with the diagnosis engine.
Never modifies state — returns a raw result for the caller to persist.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx
import structlog

from app.core.exceptions import SSRFBlockedError
from app.core.ssrf import validate_url_for_outbound
from app.models.endpoint import Endpoint
from app.monitoring.diagnosis import classify_failure
from app.monitoring.states import FailureClassification

logger = structlog.get_logger(__name__)


@dataclass
class CheckResult:
    success: bool
    status_code: int | None
    latency_ms: float | None
    failure_reason: str | None
    error_detail: str | None
    failure_classification: FailureClassification
    # Response capture (nullable — only populated on HTTP responses)
    response_body: str | None = None
    response_headers: str | None = None  # JSON-serialized, sensitive headers stripped
    content_type: str | None = None
    response_size_bytes: int | None = None


# Headers that must NEVER be stored or surfaced to the UI.
_SENSITIVE_HEADERS = frozenset({
    "authorization", "cookie", "set-cookie", "proxy-authorization",
    "x-api-key", "x-auth-token", "x-access-token",
})
_MAX_BODY_BYTES = 64 * 1024  # 64 KB cap for stored response body


def _safe_headers(response: "httpx.Response") -> str:
    """Return JSON-serialized response headers with sensitive ones stripped."""
    import json
    safe = {
        k: v for k, v in response.headers.items()
        if k.lower() not in _SENSITIVE_HEADERS
    }
    try:
        return json.dumps(safe)
    except Exception:
        return "{}"


async def run_check(endpoint: Endpoint) -> CheckResult:
    """
    Execute an HTTP health check for the given endpoint.

    Returns a CheckResult — never raises.
    All exceptions are caught here because this function is called from
    the monitoring worker and must always return a result.
    """
    timeout_s = endpoint.timeout_ms / 1000.0

    # SSRF check before making any network request
    try:
        validate_url_for_outbound(endpoint.url, context="health_check")
    except SSRFBlockedError as exc:
        return CheckResult(
            success=False,
            status_code=None,
            latency_ms=0.0,
            failure_reason="SSRF_BLOCKED",
            error_detail=str(exc),
            failure_classification=FailureClassification.UNKNOWN,
        )
    except ValueError as exc:
        return CheckResult(
            success=False,
            status_code=None,
            latency_ms=0.0,
            failure_reason="INVALID_URL",
            error_detail=str(exc),
            failure_classification=FailureClassification.UNKNOWN,
        )

    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.request(
                method=endpoint.method,
                url=endpoint.url,
                follow_redirects=True,
            )
        latency_ms = (time.perf_counter() - start) * 1000
        success = response.status_code == endpoint.expected_status

        if not success:
            failure_reason = f"UNEXPECTED_STATUS_{response.status_code}"
            classification = classify_failure(
                status_code=response.status_code,
                latency_ms=latency_ms,
                failure_reason=failure_reason,
                latency_threshold_ms=endpoint.latency_threshold_ms,
            )
            logger.warning(
                "health_check_failed",
                endpoint_id=str(endpoint.id),
                status_code=response.status_code,
                expected=endpoint.expected_status,
                latency_ms=round(latency_ms, 1),
            )
            return CheckResult(
                success=False,
                status_code=response.status_code,
                latency_ms=round(latency_ms, 1),
                failure_reason=failure_reason,
                error_detail=None,
                failure_classification=classification,
                response_body=response.text[:_MAX_BODY_BYTES] if response.text else None,
                response_headers=_safe_headers(response),
                content_type=response.headers.get("content-type"),
                response_size_bytes=len(response.content),
            )

        # Check latency threshold
        if latency_ms > endpoint.latency_threshold_ms:
            logger.warning(
                "health_check_high_latency",
                endpoint_id=str(endpoint.id),
                latency_ms=round(latency_ms, 1),
                threshold_ms=endpoint.latency_threshold_ms,
            )
            # Still success (correct status), but mark with latency issue
            return CheckResult(
                success=True,
                status_code=response.status_code,
                latency_ms=round(latency_ms, 1),
                failure_reason="HIGH_LATENCY",
                error_detail=f"Latency {latency_ms:.0f}ms > threshold {endpoint.latency_threshold_ms}ms",
                failure_classification=FailureClassification.HIGH_LATENCY,
                response_body=response.text[:_MAX_BODY_BYTES] if response.text else None,
                response_headers=_safe_headers(response),
                content_type=response.headers.get("content-type"),
                response_size_bytes=len(response.content),
            )

        logger.debug(
            "health_check_success",
            endpoint_id=str(endpoint.id),
            latency_ms=round(latency_ms, 1),
        )
        return CheckResult(
            success=True,
            status_code=response.status_code,
            latency_ms=round(latency_ms, 1),
            failure_reason=None,
            error_detail=None,
            failure_classification=FailureClassification.UNKNOWN,
            response_body=response.text[:_MAX_BODY_BYTES] if response.text else None,
            response_headers=_safe_headers(response),
            content_type=response.headers.get("content-type"),
            response_size_bytes=len(response.content),
        )

    except httpx.ConnectTimeout:
        latency_ms = (time.perf_counter() - start) * 1000
        return CheckResult(
            success=False,
            status_code=None,
            latency_ms=round(latency_ms, 1),
            failure_reason="CONNECT_TIMEOUT",
            error_detail=f"Connection timed out after {endpoint.timeout_ms}ms",
            failure_classification=FailureClassification.TIMEOUT,
        )

    except httpx.ReadTimeout:
        latency_ms = (time.perf_counter() - start) * 1000
        return CheckResult(
            success=False,
            status_code=None,
            latency_ms=round(latency_ms, 1),
            failure_reason="READ_TIMEOUT",
            error_detail=f"Read timed out after {endpoint.timeout_ms}ms",
            failure_classification=FailureClassification.TIMEOUT,
        )

    except httpx.ConnectError as exc:
        latency_ms = (time.perf_counter() - start) * 1000
        return CheckResult(
            success=False,
            status_code=None,
            latency_ms=round(latency_ms, 1),
            failure_reason="CONNECTION_ERROR",
            error_detail=str(exc)[:500],
            failure_classification=FailureClassification.EXTERNAL_SERVICE_FAILURE,
        )

    except Exception as exc:
        latency_ms = (time.perf_counter() - start) * 1000
        logger.exception(
            "health_check_unexpected_error",
            endpoint_id=str(endpoint.id),
            exc_type=type(exc).__name__,
        )
        return CheckResult(
            success=False,
            status_code=None,
            latency_ms=round(latency_ms, 1),
            failure_reason="UNEXPECTED_ERROR",
            error_detail=type(exc).__name__,
            failure_classification=FailureClassification.UNKNOWN,
        )
