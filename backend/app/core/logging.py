"""
app/core/logging.py
===================

Structured logging setup using structlog.

Design goals:
- Every log line is valid JSON in production/staging.
- Development uses human-readable console output.
- Request context is managed through structlog context variables.
- structlog integrates with Python stdlib logging.
- Third-party libraries can emit logs through the same logging pipeline.

Usage:
    from app.core.logging import get_logger

    logger = get_logger(__name__)
    logger.info("cache_hit", resource="profile", user_id="182")
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog
from structlog.types import EventDict, WrappedLogger

from app.core.config import LogFormat, get_settings


def _add_service_info(
    logger: WrappedLogger,  # noqa: ARG001
    method_name: str,  # noqa: ARG001
    event_dict: EventDict,
) -> EventDict:
    """
    Inject service metadata into every structured log event.
    """

    settings = get_settings()

    event_dict["service"] = settings.service_name
    event_dict["version"] = settings.service_version
    event_dict["env"] = settings.app_env.value

    return event_dict


def _drop_color_message_key(
    logger: WrappedLogger,  # noqa: ARG001
    method_name: str,  # noqa: ARG001
    event_dict: EventDict,
) -> EventDict:
    """
    Remove Uvicorn's color_message field.

    Uvicorn may add ANSI escape sequences to this field.
    Keeping it would make structured JSON logs unnecessarily noisy.
    """

    event_dict.pop("color_message", None)

    return event_dict


class _StructlogJsonFormatter(logging.Formatter):
    """
    Formatter used for standard-library log records.

    This allows third-party libraries such as:
    - SQLAlchemy
    - Uvicorn
    - httpx
    - APScheduler

    to produce JSON-compatible logs through the same output stream.
    """

    def format(self, record: logging.LogRecord) -> str:
        log_dict: dict[str, Any] = {
            "event": record.getMessage(),
            "level": record.levelname.lower(),
            "logger": record.name,
        }

        if record.exc_info:
            log_dict["exception"] = self.formatException(record.exc_info)

        return structlog.processors.JSONRenderer()(
            None,
            None,
            log_dict,
        )


def _create_stdlib_handler(log_format: LogFormat) -> logging.Handler:
    """
    Create the root logging handler.

    JSON mode:
        Emits machine-readable JSON.

    Development mode:
        Emits simple human-readable messages.
    """

    handler = logging.StreamHandler(sys.stdout)

    if log_format == LogFormat.JSON:
        handler.setFormatter(_StructlogJsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(message)s"))

    return handler


def configure_logging() -> None:
    """
    Configure structlog and Python standard-library logging.

    This function should be called once during application startup.
    """

    settings = get_settings()

    log_level = getattr(
        logging,
        settings.log_level.upper(),
        logging.INFO,
    )

    # ------------------------------------------------------------------
    # Shared structlog processors
    # ------------------------------------------------------------------

    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(
            fmt="iso",
            utc=True,
        ),
        _add_service_info,
        _drop_color_message_key,
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    # ------------------------------------------------------------------
    # Configure structlog
    # ------------------------------------------------------------------

    if settings.log_format == LogFormat.JSON:
        processors = [
            *shared_processors,
            structlog.processors.dict_tracebacks,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ]

    else:
        processors = [
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ]

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # ------------------------------------------------------------------
    # Configure standard-library logging
    # ------------------------------------------------------------------

    handler = _create_stdlib_handler(settings.log_format)

    logging.basicConfig(
        level=log_level,
        handlers=[handler],
        force=True,
    )

    # ------------------------------------------------------------------
    # Configure Uvicorn / third-party loggers
    # ------------------------------------------------------------------

    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("apscheduler").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """
    Return a configured structlog logger.

    Usage:
        logger = get_logger(__name__)

        logger.info(
            "endpoint_registered",
            endpoint_id=str(endpoint.id),
        )
    """

    return structlog.get_logger(name)