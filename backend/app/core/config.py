"""
app/core/config.py
==================
Central configuration loaded from environment variables via Pydantic Settings.

All other modules import from here — never read os.environ directly elsewhere.
Settings are validated at startup; missing required values cause an immediate
startup failure rather than a runtime error deep in a request path.
"""

from __future__ import annotations

from enum import Enum
from functools import lru_cache


from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Environment(str, Enum):
    """Runtime environment discriminator."""

    DEVELOPMENT = "development"
    TESTING = "testing"
    STAGING = "staging"
    PRODUCTION = "production"


class LogFormat(str, Enum):
    """Structured log output format."""

    JSON = "json"
    CONSOLE = "console"  # human-readable, for local dev


class Settings(BaseSettings):
    """
    Application settings.

    Loaded from environment variables and/or a .env file (for local dev).
    Pydantic validates all types at startup — misconfiguration is caught
    before any request is served.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # -------------------------------------------------------------------------
    # Application
    # -------------------------------------------------------------------------
    app_env: Environment = Environment.DEVELOPMENT
    debug: bool = False
    service_name: str = "self-healing-api-platform"
    service_version: str = "0.1.0"

    # -------------------------------------------------------------------------
    # Security
    # -------------------------------------------------------------------------
    secret_key: str = Field(
        default="change-me-to-a-secure-random-256-bit-secret",
        min_length=16,
        description="Secret key placeholder",
    )
    api_key: str | None = Field(
        default=None,
        description="If set, all API requests must include 'X-API-Key: <value>' header.",
    )
    # Comma-separated list of allowed hostnames, e.g. "myapi.com,api.mycompany.com".
    # If empty, any public URL is accepted (open mode).
    allowed_domains_raw: str = Field(
        default="",
        alias="ALLOWED_DOMAINS",
        description="Comma-separated list of allowed target hostnames for discovery.",
    )

    @property
    def allowed_domains(self) -> list[str]:
        """Parsed list of allowed domains (lowercase, stripped). Empty = allow all."""
        if not self.allowed_domains_raw:
            return []
        return [d.strip().lower() for d in self.allowed_domains_raw.split(",") if d.strip()]

    # -------------------------------------------------------------------------
    # Database
    # -------------------------------------------------------------------------
    database_url: str = Field(
        ...,
        description="asyncpg-compatible DSN (postgresql+asyncpg://...) or sqlite+aiosqlite:// for tests",
    )
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_pool_timeout: float = 30.0
    db_echo: bool = False  # log SQL — only enable in DEBUG mode

    # -------------------------------------------------------------------------
    # Redis
    # -------------------------------------------------------------------------
    redis_url: str = Field(
        ...,
        description="Redis DSN: redis://[:password@]host[:port]/db",
    )
    redis_password: str | None = None
    redis_socket_timeout: float = 5.0
    redis_connect_timeout: float = 5.0
    redis_max_connections: int = 50

    # -------------------------------------------------------------------------
    # Monitoring worker
    # -------------------------------------------------------------------------
    monitor_poll_interval_seconds: float = 10.0
    monitor_lock_ttl_seconds: int = 30

    # -------------------------------------------------------------------------
    # Logging
    # -------------------------------------------------------------------------
    log_level: str = "INFO"
    log_format: LogFormat = LogFormat.JSON

    # -------------------------------------------------------------------------
    # CORS
    # -------------------------------------------------------------------------
    cors_allowed_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ]

    # -------------------------------------------------------------------------
    # Rate limiting
    # -------------------------------------------------------------------------
    rate_limit_requests: int = 100
    rate_limit_window_seconds: int = 60

    # -------------------------------------------------------------------------
    # Development / testing
    # -------------------------------------------------------------------------
    development_mode: bool = False

    # -------------------------------------------------------------------------
    # Validators
    # -------------------------------------------------------------------------
    @field_validator("database_url", mode="before")
    @classmethod
    def validate_database_url(cls, v: str) -> str:
        """Normalise PostgreSQL DSN to asyncpg driver prefix. Allow sqlite:// for tests."""
        v = str(v)
        # Allow SQLite for testing
        if v.startswith("sqlite"):
            return v
        # Upgrade bare postgresql:// → postgresql+asyncpg://
        if v.startswith("postgresql://") or v.startswith("postgres://"):
            v = v.replace("postgresql://", "postgresql+asyncpg://", 1)
            v = v.replace("postgres://", "postgresql+asyncpg://", 1)
        return v

    @field_validator("secret_key")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        if len(v) < 16:  # noqa: PLR2004
            raise ValueError("secret_key must be at least 16 characters")
        return v

    # -------------------------------------------------------------------------
    # Derived helpers
    # -------------------------------------------------------------------------
    @property
    def is_development(self) -> bool:
        return self.app_env == Environment.DEVELOPMENT

    @property
    def is_testing(self) -> bool:
        return self.app_env == Environment.TESTING

    @property
    def is_production(self) -> bool:
        return self.app_env == Environment.PRODUCTION

    @property
    def failure_injection_enabled(self) -> bool:
        """
        Failure-injection endpoints are only available when BOTH:
        - development_mode is True
        - app_env is DEVELOPMENT or STAGING (never PRODUCTION)
        """
        return self.development_mode and not self.is_production

    @property
    def database_url_str(self) -> str:
        return self.database_url

    @property
    def redis_url_str(self) -> str:
        return self.redis_url


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """
    Return the cached Settings singleton.

    Using lru_cache means the .env file is parsed exactly once.
    Tests can clear this cache and inject overrides via:
        get_settings.cache_clear()
    """
    return Settings()  # type: ignore[call-arg]
