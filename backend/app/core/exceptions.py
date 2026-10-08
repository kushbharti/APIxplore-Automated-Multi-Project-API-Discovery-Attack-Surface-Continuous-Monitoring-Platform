"""
app/core/exceptions.py
=======================
Domain exception hierarchy for the self-healing platform.

Design rules (from prompt §6):
- Catch an exception only when you can handle it, classify it, add context,
  convert it to a domain exception, or perform cleanup.
- Allow unexpected exceptions to propagate to the centralized FastAPI handler.
- Never swallow exceptions silently.
- Never expose raw database errors, stack traces, or internal hostnames to callers.

Hierarchy:
    AppBaseError
    ├── AuthenticationError
    ├── AuthorizationError
    ├── NotFoundError
    ├── ConflictError
    ├── ValidationError (application-level, not Pydantic)
    ├── RateLimitError
    │
    ├── DatabaseUnavailableError
    ├── DatabaseTimeoutError
    └── DatabaseQueryError
    │
    ├── CacheUnavailableError          (added later, Phase 7)
    ├── CacheTimeoutError              (added later, Phase 7)
    │
    ├── ExternalServiceError
    │   ├── ExternalTimeoutError
    │   ├── ExternalConnectionError
    │   ├── External5xxError
    │   └── External4xxError
    │
    ├── MonitoringError                (added later, Phase 3)
    └── RecoveryError                  (added later, Phase 11)
"""

from __future__ import annotations

from typing import Any


class AppBaseError(Exception):
    """
    Root exception for all domain/application errors.

    Attributes:
        message: Human-readable description (safe to surface to operators,
                 not necessarily to end users).
        code:    Machine-readable error code used in API responses.
        context: Optional dict of structured context attached to this error;
                 included in structured logs but NOT in HTTP responses.
    """

    code: str = "INTERNAL_ERROR"
    http_status: int = 500

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        context: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        self.context: dict[str, Any] = context or {}

    def __repr__(self) -> str:
        return f"{type(self).__name__}(code={self.code!r}, message={self.message!r})"


# ---------------------------------------------------------------------------
# Auth / Access Control
# ---------------------------------------------------------------------------


class AuthenticationError(AppBaseError):
    """Raised when credentials are missing, invalid, or expired."""

    code = "AUTHENTICATION_FAILED"
    http_status = 401

    def __init__(self, message: str = "Authentication required.", **kwargs: Any) -> None:
        super().__init__(message, **kwargs)


class AuthorizationError(AppBaseError):
    """Raised when the authenticated user lacks the required permission."""

    code = "INSUFFICIENT_PERMISSIONS"
    http_status = 403

    def __init__(
        self, message: str = "You do not have permission to perform this action.", **kwargs: Any
    ) -> None:
        super().__init__(message, **kwargs)


# ---------------------------------------------------------------------------
# Resource
# ---------------------------------------------------------------------------


class NotFoundError(AppBaseError):
    """Raised when a requested resource does not exist."""

    code = "NOT_FOUND"
    http_status = 404

    def __init__(self, resource: str, identifier: Any, **kwargs: Any) -> None:
        super().__init__(f"{resource} '{identifier}' was not found.", **kwargs)
        self.resource = resource
        self.identifier = identifier


class ConflictError(AppBaseError):
    """Raised when an operation violates a uniqueness constraint."""

    code = "CONFLICT"
    http_status = 409

    def __init__(self, message: str, **kwargs: Any) -> None:
        super().__init__(message, **kwargs)


class ApplicationValidationError(AppBaseError):
    """
    Raised for application-level validation failures that fall outside
    Pydantic's schema validation scope (e.g. business-rule violations).
    """

    code = "VALIDATION_ERROR"
    http_status = 422


class RateLimitError(AppBaseError):
    """Raised when a client exceeds the configured rate limit."""

    code = "RATE_LIMIT_EXCEEDED"
    http_status = 429

    def __init__(self, message: str = "Too many requests. Please slow down.", **kwargs: Any) -> None:
        super().__init__(message, **kwargs)


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------


class DatabaseError(AppBaseError):
    """Base class for database-related errors."""

    code = "DATABASE_ERROR"
    http_status = 503


class DatabaseUnavailableError(DatabaseError):
    """
    Raised when the database cannot be reached at all.
    Recovery action: reconnect / wait / serve from cache.
    """

    code = "DATABASE_UNAVAILABLE"

    def __init__(
        self, message: str = "The database is currently unavailable.", **kwargs: Any
    ) -> None:
        super().__init__(message, **kwargs)


class DatabaseTimeoutError(DatabaseError):
    """
    Raised when a database operation exceeds the configured timeout.
    Recovery action: retry with exponential backoff.
    """

    code = "DATABASE_TIMEOUT"

    def __init__(
        self, message: str = "The database operation timed out.", **kwargs: Any
    ) -> None:
        super().__init__(message, **kwargs)


class DatabaseQueryError(DatabaseError):
    """
    Raised for unexpected query/constraint errors that are not a connection failure.
    These should be logged and escalated — not retried automatically.
    """

    code = "DATABASE_QUERY_ERROR"

    def __init__(self, message: str = "A database query error occurred.", **kwargs: Any) -> None:
        super().__init__(message, **kwargs)


# ---------------------------------------------------------------------------
# Cache (Phase 7 — declared here so exception handlers can be registered now)
# ---------------------------------------------------------------------------


class CacheError(AppBaseError):
    """Base class for Redis/cache errors."""

    code = "CACHE_ERROR"
    http_status = 503


class CacheUnavailableError(CacheError):
    """
    Raised when Redis cannot be reached.
    The application must decide whether it can continue without cache.
    Redis failure MUST NOT crash the API.
    """

    code = "CACHE_UNAVAILABLE"

    def __init__(
        self, message: str = "The cache layer is currently unavailable.", **kwargs: Any
    ) -> None:
        super().__init__(message, **kwargs)


class CacheTimeoutError(CacheError):
    """Raised when a Redis operation exceeds the configured timeout."""

    code = "CACHE_TIMEOUT"

    def __init__(
        self, message: str = "The cache operation timed out.", **kwargs: Any
    ) -> None:
        super().__init__(message, **kwargs)


# ---------------------------------------------------------------------------
# External HTTP Services
# ---------------------------------------------------------------------------


class ExternalServiceError(AppBaseError):
    """Base class for external API / third-party service errors."""

    code = "EXTERNAL_SERVICE_ERROR"
    http_status = 502

    def __init__(self, message: str, *, service: str | None = None, **kwargs: Any) -> None:
        super().__init__(message, **kwargs)
        self.service = service
        if service:
            self.context["service"] = service


class ExternalTimeoutError(ExternalServiceError):
    """Raised when an HTTP call to an external service times out."""

    code = "EXTERNAL_TIMEOUT"

    def __init__(self, service: str, **kwargs: Any) -> None:
        super().__init__(f"Request to '{service}' timed out.", service=service, **kwargs)


class ExternalConnectionError(ExternalServiceError):
    """Raised when a connection to an external service cannot be established."""

    code = "EXTERNAL_CONNECTION_FAILURE"

    def __init__(self, service: str, **kwargs: Any) -> None:
        super().__init__(
            f"Could not connect to external service '{service}'.", service=service, **kwargs
        )


class External5xxError(ExternalServiceError):
    """Raised when an external service returns a 5xx status code."""

    code = "EXTERNAL_5XX"

    def __init__(self, service: str, status_code: int, **kwargs: Any) -> None:
        super().__init__(
            f"External service '{service}' returned {status_code}.",
            service=service,
            **kwargs,
        )
        self.status_code = status_code


class External4xxError(ExternalServiceError):
    """
    Raised when an external service returns a 4xx status code.
    These should generally NOT be retried.
    """

    code = "EXTERNAL_4XX"

    def __init__(self, service: str, status_code: int, **kwargs: Any) -> None:
        super().__init__(
            f"External service '{service}' returned {status_code}.",
            service=service,
            **kwargs,
        )
        self.status_code = status_code


# ---------------------------------------------------------------------------
# Monitoring / Recovery (placeholders; fully implemented in later phases)
# ---------------------------------------------------------------------------


class MonitoringError(AppBaseError):
    """Raised by the monitoring subsystem for internal errors."""

    code = "MONITORING_ERROR"
    http_status = 500


class RecoveryError(AppBaseError):
    """Raised when a recovery action fails or cannot be applied."""

    code = "RECOVERY_ERROR"
    http_status = 500


class SSRFBlockedError(AppBaseError):
    """
    Raised when an outbound URL is blocked by SSRF protection.

    Triggered when:
    - URL scheme is not http/https
    - Hostname resolves to a private/loopback/link-local IP
    - Hostname is a known cloud metadata endpoint
    - DNS resolution fails entirely

    Never expose internal details (resolved IPs) in the HTTP response.
    """

    code = "SSRF_BLOCKED"
    http_status = 422

    def __init__(
        self, message: str = "The requested URL is not allowed.", **kwargs: Any
    ) -> None:
        super().__init__(message, **kwargs)


class DiscoveryError(AppBaseError):
    """Raised when endpoint discovery encounters a non-recoverable error."""

    code = "DISCOVERY_ERROR"
    http_status = 500

    def __init__(self, message: str, **kwargs: Any) -> None:
        super().__init__(message, **kwargs)


class ProjectNotFoundError(NotFoundError):
    """Raised when a project is not found."""

    def __init__(self, project_id: Any, **kwargs: Any) -> None:
        super().__init__("Project", project_id, **kwargs)
