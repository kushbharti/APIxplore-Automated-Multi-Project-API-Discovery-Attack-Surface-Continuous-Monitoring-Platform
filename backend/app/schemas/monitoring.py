from datetime import datetime
from pydantic import BaseModel, Field

class MonitoringConfigUpdate(BaseModel):
    enabled: bool | None = None
    interval_seconds: int | None = Field(default=None, ge=5, le=3600)

class MonitoringConfigOut(BaseModel):
    enabled: bool
    interval_seconds: int
    last_check: datetime | None
    next_check: datetime | None
    status: str
