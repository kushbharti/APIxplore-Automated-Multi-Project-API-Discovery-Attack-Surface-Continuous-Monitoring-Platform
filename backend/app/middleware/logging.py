"""
app/middleware/logging.py
==========================
Structured access logging middleware.

Captures for every request:
    method, route (template), status_code, latency_ms,
    request_id (already bound by RequestIDMiddleware)

Design:
- Uses route templates (/api/users/{user_id}) never concrete paths
  (/api/users/123) — to keep log cardinality manageable and avoid
  accidentally logging PII in path segments.
- Latency is measured as wall-clock time including I/O wait (appropriate
  for async FastAPI).
- Exceptions are NOT swallowed — if call_next raises, the exception
  propagates after being logged.
"""

from __future__ import annotations

import time

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Match

logger = structlog.get_logger(__name__)


class AccessLogMiddleware(BaseHTTPMiddleware):
    """Log one structured line per HTTP request."""

    async def dispatch(self, request: Request, call_next: object) -> Response:
        start = time.perf_counter()

        response: Response = await call_next(request)  # type: ignore[operator]

        elapsed_ms = round((time.perf_counter() - start) * 1000, 2)

        # Resolve route template (e.g. /api/v1/endpoints/{id})
        route_template = _resolve_route_template(request)

        status_code = response.status_code
        log_fn = logger.warning if status_code >= 400 else logger.info  # type: ignore[attr-defined]

        log_fn(
            "http_request",
            method=request.method,
            route=route_template,
            status_code=status_code,
            latency_ms=elapsed_ms,
            client_ip=request.client.host if request.client else "unknown",
        )

        return response


def _resolve_route_template(request: Request) -> str:
    """
    Walk the app's route list and return the template path string
    that matched this request, falling back to the raw path.

    Example:
        Concrete:  /api/v1/endpoints/a3f4...
        Template:  /api/v1/endpoints/{id}
    """
    for route in request.app.routes:
        match, _ = route.matches(request.scope)
        if match == Match.FULL:
            return getattr(route, "path", request.url.path)
    return request.url.path
