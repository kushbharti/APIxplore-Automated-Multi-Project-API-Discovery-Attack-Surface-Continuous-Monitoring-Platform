"""
app/recovery/backoff.py
========================
Exponential backoff with jitter.

Configuration:
    initial_delay_s: first retry delay (default 1s)
    max_delay_s:     maximum delay cap (default 60s)
    multiplier:      backoff multiplier (default 2x)
    jitter:          add random jitter to prevent thundering herd
    max_attempts:    stop after this many attempts
"""

from __future__ import annotations

import asyncio
import random
from dataclasses import dataclass, field


@dataclass
class BackoffConfig:
    max_attempts: int = 3
    initial_delay_s: float = 1.0
    max_delay_s: float = 60.0
    multiplier: float = 2.0
    jitter: bool = True


def compute_delay(attempt: int, config: BackoffConfig) -> float:
    """
    Compute the wait time for a given attempt number (0-indexed).

    Sequence: 1s, 2s, 4s, 8s, ... capped at max_delay_s.
    With jitter: multiply by random [0.75, 1.25].
    """
    delay = min(
        config.initial_delay_s * (config.multiplier ** attempt),
        config.max_delay_s,
    )
    if config.jitter:
        delay *= random.uniform(0.75, 1.25)
    return delay


async def wait_for_next_attempt(attempt: int, config: BackoffConfig) -> None:
    """Async sleep for the computed backoff delay."""
    delay = compute_delay(attempt, config)
    await asyncio.sleep(delay)
