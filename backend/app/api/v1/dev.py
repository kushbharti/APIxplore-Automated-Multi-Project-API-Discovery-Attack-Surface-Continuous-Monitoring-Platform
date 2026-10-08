"""
app/api/v1/dev.py
==================
Failure injection endpoints — development/testing only.
Enabled only when DEVELOPMENT_MODE=true in .env.
Authentication removed (internal tool, use network-level security).
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter
from app.schemas.common import DataResponse
from app.core.exceptions import DatabaseTimeoutError

router = APIRouter(
    prefix="/dev/inject",
    tags=["Failure Injection (Dev Only)"],
)


@router.post("/database-failure", response_model=DataResponse[dict])
async def inject_database_failure() -> DataResponse[dict]:
    """Simulates a database timeout or connection error."""
    raise DatabaseTimeoutError("Simulated database timeout failure.")


@router.post("/redis-timeout", response_model=DataResponse[dict])
async def inject_redis_timeout() -> DataResponse[dict]:
    """Simulates a Redis cache timeout."""
    await asyncio.sleep(2)
    return DataResponse(data={"status": "error", "message": "Simulated Redis connection timeout."})


@router.post("/latency", response_model=DataResponse[dict])
async def inject_latency(delay_ms: int = 2000) -> DataResponse[dict]:
    """Simulates a generic latency spike."""
    await asyncio.sleep(delay_ms / 1000.0)
    return DataResponse(data={"status": "success", "message": f"Simulated latency of {delay_ms}ms completed."})
