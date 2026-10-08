"""
app/middleware/request_id.py
=============================
Starlette middleware that injects a unique Request ID into every request.

Behaviour:
- If the incoming request carries an X-Request-ID header, that value is used
  (allows propagation from upstream proxies / API gateways).
- Otherwise a new UUID4 is generated.
- The request_id is:
  1. Stored in request.state.request_id for downstream handlers.
  2. Bound into structlog's context variables so every log line in the
     request lifecycle automatically carries it.
  3. Echoed back in the X-Request-ID response header so clients/operators
     can correlate their request with backend logs.
"""

from __future__ import annotations

import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

REQUEST_ID_HEADER = "X-Request-ID"


class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    Attach a request ID to every incoming request.

    Registered in app/main.py before other middleware so the ID is
    available to all downstream components.
    """

    async def dispatch(self, request: Request, call_next: object) -> Response:
        # Extract or generate the request ID
        request_id = request.headers.get(REQUEST_ID_HEADER) or f"req_{uuid.uuid4().hex[:16]}"

        # Attach to request state so route handlers can read it if needed
        request.state.request_id = request_id

        # Bind to structlog's per-request context — cleared automatically
        # after the request completes by structlog's contextvars integration
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)

        # Process the request
        response: Response = await call_next(request)  # type: ignore[operator]

        # Echo the ID in the response header
        response.headers[REQUEST_ID_HEADER] = request_id
        return response
