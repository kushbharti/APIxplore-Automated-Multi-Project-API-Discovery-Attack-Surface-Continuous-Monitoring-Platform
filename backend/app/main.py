"""
app/main.py
============
FastAPI application factory.

Responsibilities:
- Create the FastAPI app instance with lifespan management.
- Register all middleware (order matters: request ID first).
- Register all routers.
- Register centralized exception handlers.

Architecture rules applied here:
- No business logic in this file.
- No database queries.
- Exception handlers only log + format responses — no domain logic.
- Stack traces NEVER appear in HTTP responses.
- request_id is always included in error responses.
"""

from __future__ import annotations

import traceback
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator

import structlog
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import system, endpoints, incidents, cache, dev, projects, discovery, analytics
from app.core.config import get_settings
from app.core.exceptions import AppBaseError
from app.core.logging import configure_logging
from app.db.session import close_engine, get_session_factory
from app.middleware.auth import APIKeyMiddleware
from app.middleware.logging import AccessLogMiddleware
from app.middleware.rate_limit import RateLimitMiddleware
from app.middleware.request_id import RequestIDMiddleware
from app.middleware.telemetry import TelemetryMiddleware
from app.workers.monitor import create_scheduler

logger = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Application lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:  # noqa: ARG001
    """
    Manage startup and shutdown tasks.

    Startup:
    1. Configure structured logging (must be first).
    2. Log application start.
    3. Start APScheduler monitoring worker.

    Shutdown:
    1. Shut down scheduler.
    2. Dispose the database connection pool.
    """
    # 1. Logging must be configured before anything else logs
    configure_logging()

    settings = get_settings()
    logger.info(
        "application_starting",
        service=settings.service_name,
        version=settings.service_version,
        environment=settings.app_env.value,
    )

    # 2. Start APScheduler (Monitoring worker)
    scheduler = create_scheduler()
    if not settings.is_testing:
        scheduler.start()
        logger.info("scheduler_started")

    logger.info("application_started")

    yield  # Application is now running

    # Shutdown
    logger.info("application_shutting_down")
    if not settings.is_testing:
        scheduler.shutdown()
        logger.info("scheduler_stopped")
    await close_engine()
    logger.info("application_stopped")


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------


def create_app() -> FastAPI:
    """
    Build and return the FastAPI application.

    Called once at module load time. Kept as a factory function to
    make testing easier (tests can call create_app() to get a fresh instance).
    """
    settings = get_settings()

    app = FastAPI(
        title="API Endpoint Discovery & Monitoring Platform",
        description=(
            "Automated multi-project API endpoint discovery, verification, "
            "continuous monitoring, incident management, and observability platform."
        ),
        version=settings.service_version,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url="/redoc" if not settings.is_production else None,
        openapi_url="/openapi.json" if not settings.is_production else None,
        lifespan=lifespan,
    )

    # ------------------------------------------------------------------
    # Middleware (registered in reverse execution order in Starlette)
    # ------------------------------------------------------------------

    # CORS — must be first (outermost) so preflight requests are handled
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )

    # API key authentication (no-op when API_KEY env var is not set)
    app.add_middleware(APIKeyMiddleware, api_key=settings.api_key)

    # Rate limiting — per-IP sliding window
    app.add_middleware(
        RateLimitMiddleware,
        requests_per_window=settings.rate_limit_requests,
        window_seconds=settings.rate_limit_window_seconds,
    )

    # Access logging — wraps the request after ID is assigned
    app.add_middleware(AccessLogMiddleware)

    # Telemetry metrics
    app.add_middleware(TelemetryMiddleware)

    # Request ID — must be innermost so it runs first, before logging
    app.add_middleware(RequestIDMiddleware)

    # ------------------------------------------------------------------
    # Routers
    # ------------------------------------------------------------------

    # Health / system — registered at root level (not under /api/v1)
    app.include_router(system.router)

    # Versioned API
    app.include_router(projects.router, prefix="/api/v1")
    app.include_router(discovery.router, prefix="/api/v1")
    app.include_router(endpoints.router, prefix="/api/v1")
    app.include_router(incidents.router, prefix="/api/v1")
    app.include_router(analytics.router, prefix="/api/v1")
    app.include_router(cache.router, prefix="/api/v1")
    app.include_router(dev.router, prefix="/api/v1")

    # ------------------------------------------------------------------
    # Exception handlers
    # ------------------------------------------------------------------

    _register_exception_handlers(app)

    return app


# ---------------------------------------------------------------------------
# Centralized exception handlers
# ---------------------------------------------------------------------------


def _get_request_id(request: Request) -> str:
    return getattr(request.state, "request_id", "unknown")


def _error_response(
    request: Request,
    status_code: int,
    code: str,
    message: str,
) -> JSONResponse:
    """Build a consistent, safe error JSON response."""
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "request_id": _get_request_id(request),
            }
        },
    )


def _register_exception_handlers(app: FastAPI) -> None:
    """
    Register all exception handlers.

    Rules:
    - Never expose stack traces.
    - Always include request_id.
    - Log full context internally before returning.
    - Never return database passwords, SQL, hostnames, file paths.
    """

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        """Pydantic request validation failures — 422."""
        logger.warning(
            "request_validation_error",
            errors=exc.errors(),
            route=str(request.url.path),
        )
        first_error = exc.errors()[0] if exc.errors() else {}
        field = " → ".join(str(loc) for loc in first_error.get("loc", []))
        msg = first_error.get("msg", "Validation error")
        safe_message = f"Validation error on '{field}': {msg}" if field else msg

        return _error_response(
            request,
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "VALIDATION_ERROR",
            safe_message,
        )

    @app.exception_handler(AppBaseError)
    async def domain_error_handler(request: Request, exc: AppBaseError) -> JSONResponse:
        """
        All domain/application exceptions — mapped to their HTTP status.
        Context dict is logged internally but never returned to the caller.
        """
        logger.warning(
            "domain_error",
            error_code=exc.code,
            error_message=exc.message,
            context=exc.context,
            route=str(request.url.path),
        )
        return _error_response(request, exc.http_status, exc.code, exc.message)

    @app.exception_handler(ValueError)
    async def value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
        """ValueError — used in services for business-rule validation failures."""
        logger.warning(
            "value_error",
            detail=str(exc),
            route=str(request.url.path),
        )
        return _error_response(
            request,
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "VALIDATION_ERROR",
            str(exc),
        )

    @app.exception_handler(Exception)
    async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
        """
        Catch-all for truly unexpected exceptions.

        IMPORTANT: This is the ONLY place in the codebase where a bare
        Exception is caught — deliberately at the outermost boundary.

        Logs full traceback internally.
        Returns a safe, generic error message to the caller.
        Never exposes internals.
        """
        logger.error(
            "unexpected_error",
            exc_type=type(exc).__name__,
            traceback=traceback.format_exc(),
            route=str(request.url.path),
            method=request.method,
        )
        return _error_response(
            request,
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "INTERNAL_SERVER_ERROR",
            "An unexpected error occurred. Please contact support if the problem persists.",
        )


# ---------------------------------------------------------------------------
# Application instance (module-level singleton)
# ---------------------------------------------------------------------------

app = create_app()
