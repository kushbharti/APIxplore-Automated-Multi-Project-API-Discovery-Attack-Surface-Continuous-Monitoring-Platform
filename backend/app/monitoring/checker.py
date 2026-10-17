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


async def run_check(
    endpoint: Endpoint,
    path_params: dict[str, str] | None = None,
    query_params: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
    body: str | dict | list | int | float | bool | None = None,
    content_type: str | None = None,
) -> CheckResult:
    """
    Execute an HTTP health check for the given endpoint.

    Supports optional path_params, query_params, headers, and body.
    Returns a CheckResult — never raises.
    All exceptions are caught here because this function is called from
    the monitoring worker and must always return a result.
    """
    import json as _json

    timeout_s = endpoint.timeout_ms / 1000.0

    target_url = endpoint.url
    if path_params:
        for p_key, p_val in path_params.items():
            target_url = target_url.replace(f"{{{p_key}}}", str(p_val)).replace(f":{p_key}", str(p_val))

    # SSRF check before making any network request
    try:
        validate_url_for_outbound(target_url, context="health_check")
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

    # Prepare custom headers and body if provided
    req_headers: dict[str, str] = {}
    if headers:
        for k, v in headers.items():
            if k.lower() not in _SENSITIVE_HEADERS:
                req_headers[k] = str(v)

    req_content: bytes | None = None
    req_json: dict | list | None = None

    if body is not None:
        if isinstance(body, (dict, list)):
            req_json = body
        elif isinstance(body, str):
            req_content = body.encode("utf-8")
        else:
            req_content = str(body).encode("utf-8")

    if content_type:
        if not any(k.lower() == "content-type" for k in req_headers):
            req_headers["Content-Type"] = content_type
    elif req_content is not None and not any(k.lower() == "content-type" for k in req_headers):
        req_headers["Content-Type"] = "application/json"

    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            request_kwargs = {
                "method": endpoint.method,
                "url": target_url,
                "follow_redirects": True,
            }
            if query_params:
                request_kwargs["params"] = query_params
            if req_headers:
                request_kwargs["headers"] = req_headers
            if req_json is not None:
                request_kwargs["json"] = req_json
            elif req_content is not None:
                request_kwargs["content"] = req_content

            response = await client.request(**request_kwargs)
        latency_ms = (time.perf_counter() - start) * 1000
        success = response.status_code == endpoint.expected_status

        # Verify response validity: HTTP 200 does not prove API correctness if redirected to login or returning HTML error/fallback
        content_type = response.headers.get("content-type", "")
        resp_text = response.text or ""

        from app.discovery.verifier import (
            _is_auth_redirect,
            _is_html_error_page,
            _is_spa_fallback,
        )

        expects_html = bool(
            (endpoint.tags and "html" in endpoint.tags.lower())
            or (endpoint.path and endpoint.path.lower().endswith(".html"))
            or (endpoint.url and endpoint.url.lower().endswith(".html"))
        )

        failure_reason: str | None = None
        error_detail: str | None = None
        classification = FailureClassification.UNKNOWN

        if success and len(response.history) > 0 and _is_auth_redirect(str(response.url)):
            success = False
            failure_reason = "REDIRECTED_TO_AUTH"
            error_detail = f"Endpoint redirected to authentication page: {response.url}"
            classification = FailureClassification.APPLICATION_FAILURE
        elif success and not expects_html and "html" in content_type.lower():
            if _is_html_error_page(resp_text):
                success = False
                failure_reason = "HTML_ERROR_PAGE"
                error_detail = "Server returned HTML error page with HTTP 200"
                classification = FailureClassification.APPLICATION_FAILURE
            elif _is_spa_fallback(resp_text):
                success = False
                failure_reason = "UNEXPECTED_HTML_FALLBACK"
                error_detail = "Server returned SPA index.html fallback for API route"
                classification = FailureClassification.APPLICATION_FAILURE

        if not success:
            if not failure_reason:
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
                reason=failure_reason,
                latency_ms=round(latency_ms, 1),
            )
            return CheckResult(
                success=False,
                status_code=response.status_code,
                latency_ms=round(latency_ms, 1),
                failure_reason=failure_reason,
                error_detail=error_detail,
                failure_classification=classification,
                response_body=resp_text[:_MAX_BODY_BYTES] if resp_text else None,
                response_headers=_safe_headers(response),
                content_type=content_type,
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
