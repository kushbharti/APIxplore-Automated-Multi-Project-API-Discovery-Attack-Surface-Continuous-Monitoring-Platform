"""
app/discovery/github.py
=======================
Retired module — GitHub-specific discovery features have been completely removed.
Generic URL-based discovery (OpenAPI, Crawler, JavaScript) is used for all targets.
"""

from __future__ import annotations


def parse_github_target(url: str) -> dict:
    return {"kind": "invalid", "error": "GitHub targets are not supported."}


async def discover_github_repo(*args, **kwargs):
    raise NotImplementedError("GitHub discovery has been removed.")
