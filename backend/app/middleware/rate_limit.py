"""
app/middleware/rate_limit.py
=============================
In-memory sliding-window rate limiter middleware.

Limits requests per client IP using the settings::

    RATE_LIMIT_REQUESTS  (default 100)
    RATE_LIMIT_WINDOW_SECONDS  (default 60)

When the limit is exceeded the middleware returns 429 Too Many Requests
with a Retry-After header.

Note: This is a single-process in-memory limiter suitable for development
and small deployments. For multi-process / distributed deployments, swap
the counter for a Redis-backed implementation.
"""

from __future__ import annotations

import json
import time
from collections import defaultdict, deque
from threading import Lock

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

import structlog

logger = structlog.get_logger(__name__)

# Paths excluded from rate limiting (health probes, static assets)
_EXEMPT_PREFIXES = ("/health", "/docs", "/redoc", "/openapi.json")


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Sliding-window rate limiter keyed on client IP address.

    Stores a deque of request timestamps per IP. On each request, old
    timestamps outside the window are dropped, then the current count
    is compared against the limit.
    """

    def __init__(self, app, requests_per_window: int, window_seconds: int) -> None:
        super().__init__(app)
        self._limit = requests_per_window
        self._window = window_seconds
        self._clients: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def _get_client_ip(self, request: Request) -> str:
        # Respect X-Forwarded-For if behind a trusted proxy
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        if request.client:
            return request.client.host
        return "unknown"

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path
        if any(path.startswith(p) for p in _EXEMPT_PREFIXES):
            return await call_next(request)

        ip = self._get_client_ip(request)
        now = time.monotonic()
        window_start = now - self._window

        with self._lock:
            timestamps = self._clients[ip]
            # Evict timestamps outside the window
            while timestamps and timestamps[0] < window_start:
                timestamps.popleft()

            count = len(timestamps)
            if count >= self._limit:
                retry_after = int(self._window - (now - timestamps[0])) + 1
                logger.warning(
                    "rate_limit_exceeded",
                    ip=ip,
                    path=path,
                    count=count,
                    limit=self._limit,
                )
                body = json.dumps({
                    "error": {
                        "code": "RATE_LIMIT_EXCEEDED",
                        "message": (
                            f"Too many requests. Limit is {self._limit} requests "
                            f"per {self._window}s. Retry after {retry_after}s."
                        ),
                        "request_id": getattr(request.state, "request_id", "unknown"),
                    }
                })
                return Response(
                    content=body,
                    status_code=429,
                    media_type="application/json",
                    headers={"Retry-After": str(retry_after)},
                )

            timestamps.append(now)

        return await call_next(request)
