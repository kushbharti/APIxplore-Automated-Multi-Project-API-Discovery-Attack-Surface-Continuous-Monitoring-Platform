"""app/models/__init__.py
Import all models so Alembic's env.py discovers them via Base.metadata.
"""

from app.models.base import Base  # noqa: F401
from app.models.project import Project  # noqa: F401
from app.models.endpoint import Endpoint  # noqa: F401
from app.models.health_check import HealthCheck  # noqa: F401
from app.models.incident import Incident  # noqa: F401
from app.models.recovery_action import RecoveryAction  # noqa: F401
from app.models.alert_event import AlertEvent  # noqa: F401
from app.models.discovery_run import DiscoveryRun  # noqa: F401
from app.models.discovery_candidate import DiscoveryCandidate  # noqa: F401
from app.models.user import User  # noqa: F401
