"""
app/api/v1/cache.py
====================
Cache management API.

Provides Redis health status and cache policy information.
The user-specific cache endpoints have been simplified since authentication
has been removed from the platform.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from app.cache.client import check_redis_health
from app.cache.policies import list_policies
from app.schemas.common import DataResponse

router = APIRouter(prefix="/cache", tags=["Cache"])


@router.get("/policies", response_model=DataResponse[list[dict]])
async def get_cache_policies(request: Request) -> DataResponse[list[dict]]:
    """List configured cache policies."""
    rid = getattr(request.state, "request_id", "unknown")
    policies = [
        {
            "resource": p.resource,
            "priority": p.priority,
            "ttl_seconds": p.ttl_seconds,
            "max_stale_seconds": p.max_stale_seconds,
            "fallback_enabled": p.fallback_enabled,
        }
        for p in list_policies()
    ]
    return DataResponse(data=policies, request_id=rid)


@router.get("/status", response_model=DataResponse[dict])
async def get_cache_status(request: Request) -> DataResponse[dict]:
    """Redis health and cache policy overview."""
    rid = getattr(request.state, "request_id", "unknown")
    redis_ok = await check_redis_health()
    return DataResponse(
        data={
            "redis_available": redis_ok,
            "status": "healthy" if redis_ok else "degraded",
            "policies_count": len(list_policies()),
        },
        request_id=rid,
    )
