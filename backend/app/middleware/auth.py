"""
app/middleware/auth.py
======================
Optional API-key authentication middleware.

When the ``API_KEY`` environment variable is set, every inbound request
(except health-check endpoints) must include the header::

    X-API-Key: <your-key>

Requests missing or with a wrong key get a 401 JSON response.
If ``API_KEY`` is not configured, the middleware is a no-op (open mode).
"""

from __future__ import annotations

import json

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

import structlog

logger = structlog.get_logger(__name__)

# Paths that are never gated — infrastructure health probes
_PUBLIC_PREFIXES = (
    "/health",
    "/docs",
    "/redoc",
    "/openapi.json",
)


class APIKeyMiddleware(BaseHTTPMiddleware):
    """
    Check X-API-Key header if the platform is configured with an API key.

    If ``api_key`` is None or empty the middleware passes every request
    through unchanged (backward-compatible open mode).
    """

    def __init__(self, app, api_key: str | None) -> None:
        super().__init__(app)
        self._key = api_key or None

    async def dispatch(self, request: Request, call_next) -> Response:
        # No key configured → open mode, pass through
        if not self._key:
            return await call_next(request)

        # Health / docs endpoints are always public
        path = request.url.path
        if any(path.startswith(prefix) for prefix in _PUBLIC_PREFIXES):
            return await call_next(request)

        # Validate the header
        provided = request.headers.get("X-API-Key", "")
        if provided != self._key:
            logger.warning(
                "api_key_rejected",
                path=path,
                method=request.method,
                provided_prefix=provided[:6] if provided else "(none)",
            )
            body = json.dumps({
                "error": {
                    "code": "UNAUTHORIZED",
                    "message": "Missing or invalid API key. Provide a valid 'X-API-Key' header.",
                    "request_id": getattr(request.state, "request_id", "unknown"),
                }
            })
            return Response(
                content=body,
                status_code=401,
                media_type="application/json",
            )

        return await call_next(request)
