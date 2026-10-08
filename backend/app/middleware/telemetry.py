"""
app/middleware/telemetry.py
============================
Telemetry middleware — captures Prometheus metrics per request.

Captures: method, route_template, status_code, latency.
Never captures: user_id, request_id, incident_id (high cardinality → logs/traces).
"""

from __future__ import annotations

import time

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Match

from app.observability.metrics import (
    HTTP_ERRORS_TOTAL,
    HTTP_REQUESTS_TOTAL,
    HTTP_REQUEST_DURATION_SECONDS,
)

logger = structlog.get_logger(__name__)

# Routes to skip metrics for (avoid polluting metrics with probe traffic)
_SKIP_ROUTES = {"/health/live", "/health/ready", "/metrics"}


class TelemetryMiddleware(BaseHTTPMiddleware):
    """Record Prometheus metrics for every HTTP request."""

    async def dispatch(self, request: Request, call_next: object) -> Response:
        path = request.url.path

        if path in _SKIP_ROUTES:
            return await call_next(request)  # type: ignore[operator]

        route_template = _resolve_route_template(request)
        method = request.method
        start = time.perf_counter()

        response: Response = await call_next(request)  # type: ignore[operator]

        duration = time.perf_counter() - start
        status = str(response.status_code)

        HTTP_REQUESTS_TOTAL.labels(
            method=method, route=route_template, status_code=status
        ).inc()

        HTTP_REQUEST_DURATION_SECONDS.labels(
            method=method, route=route_template
        ).observe(duration)

        if response.status_code >= 400:
            HTTP_ERRORS_TOTAL.labels(
                method=method, route=route_template, status_code=status
            ).inc()

        return response


def _resolve_route_template(request: Request) -> str:
    for route in request.app.routes:
        match, _ = route.matches(request.scope)
        if match == Match.FULL:
            return getattr(route, "path", request.url.path)
    return request.url.path
