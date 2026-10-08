"""
app/observability/metrics.py
=============================
Prometheus metrics definitions.

Cardinality rules (from prompt §33):
- NEVER use user_id, request_id, or incident_id as labels.
- Use route_template, method, status_code, service as labels.
- Keep label cardinality bounded (< ~50 unique values per label).
"""

from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, generate_latest

# ---------------------------------------------------------------------------
# HTTP metrics (Phase 6 — Request Observability)
# ---------------------------------------------------------------------------

HTTP_REQUESTS_TOTAL = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "route", "status_code"],
)

HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration",
    ["method", "route"],
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0],
)

HTTP_ERRORS_TOTAL = Counter(
    "http_errors_total",
    "Total HTTP errors (4xx + 5xx)",
    ["method", "route", "status_code"],
)

# ---------------------------------------------------------------------------
# Endpoint health metrics
# ---------------------------------------------------------------------------

ENDPOINT_HEALTH_STATE = Gauge(
    "endpoint_health_state",
    "Current health state of a monitored endpoint (1=healthy, 0=unhealthy)",
    ["endpoint_name"],
)

ENDPOINT_LATENCY_SECONDS = Histogram(
    "endpoint_latency_seconds",
    "Health check latency for monitored endpoints",
    ["endpoint_name"],
    buckets=[0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0],
)

ENDPOINT_CHECK_TOTAL = Counter(
    "endpoint_check_total",
    "Total health checks executed",
    ["endpoint_name", "success"],
)

# ---------------------------------------------------------------------------
# Incident metrics
# ---------------------------------------------------------------------------

INCIDENTS_TOTAL = Counter(
    "incidents_total",
    "Total incidents created",
    ["failure_type", "severity"],
)

INCIDENTS_ACTIVE = Gauge(
    "incidents_active",
    "Currently active (unresolved) incidents",
)

RECOVERY_ATTEMPTS_TOTAL = Counter(
    "recovery_attempts_total",
    "Total recovery attempts",
    ["action_type", "success"],
)

# ---------------------------------------------------------------------------
# Cache metrics
# ---------------------------------------------------------------------------

CACHE_HITS_TOTAL = Counter(
    "cache_hits_total",
    "Total cache hits",
    ["resource", "priority"],
)

CACHE_MISSES_TOTAL = Counter(
    "cache_misses_total",
    "Total cache misses",
    ["resource"],
)

CACHE_FALLBACK_TOTAL = Counter(
    "cache_fallback_total",
    "Total degraded responses served from cache",
    ["resource"],
)


def get_metrics_output() -> bytes:
    """Return Prometheus text format metrics for scraping."""
    return generate_latest()
