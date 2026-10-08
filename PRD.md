# Product Requirements Document

**Product:** Automated Multi-Project API Attack Surface Discovery & Security Monitoring Platform  
**Status:** Authoritative product-intent specification; implementation status is **IMPLEMENTATION-UNVERIFIED** (no repository evidence was supplied for this specification-based brief).  
**Audience:** Product, backend, frontend, security, QA, and hackathon reviewers.

## 1. Product overview

A self-hosted web application for discovering and tracking publicly reachable API attack surface across multiple projects. A user supplies a public project URL; the system safely discovers candidate APIs from API documentation, constrained crawling, and public JavaScript, verifies only requests it can safely make, maintains a deduplicated inventory, and optionally monitors supported endpoints. It records health history, incidents, alerts, discovery runs, and snapshot changes in one dashboard.

The product is an **attack-surface discovery and security-monitoring platform**, not a vulnerability scanner and not merely an uptime dashboard. A public endpoint is an exposure to inventory—not, by itself, a vulnerability. Discovery is best-effort and bounded; the system must state its coverage limits and never imply that it finds every API.

## 2. Problem, goals, and non-goals

### Problem
Teams lack a low-friction way to discover, verify, document, and keep track of publicly reachable APIs as applications change. Manual inventories become stale, while unbounded probes create safety and reliability risks.

### Goals
- **G-1** Make adding a public project and starting safe discovery straightforward.
- **G-2** Preserve candidate provenance and verification uncertainty; deduplicate logical endpoints.
- **G-3** Provide a usable endpoint registry and real, asynchronous monitoring with history.
- **G-4** Detect health incidents and attack-surface changes with actionable, deduplicated alerts.
- **G-5** Support multiple independent projects and present consolidated real system/project state.
- **G-6** Demonstrate a complete vertical workflow with simple Docker Compose deployment.

### Non-goals
- Authentication, registration, login, logout, JWTs, password storage, protected routes, or user/role management in this version.
- Authentication-dependent or private API discovery; credential vaults; authenticated monitoring.
- Exploit attempts, fuzzing, destructive requests, vulnerability scanning, or claims of vulnerability without evidence.
- Guaranteed or exhaustive discovery; arbitrary internet crawling; unrestricted browser automation.
- Kubernetes, mandatory hosted services, AI/ML, microservices, or a complex event platform.
- Automated remediation, ticketing integrations, or external notification channels not specified here.

## 3. Users and primary journey

**Target user:** A developer, security engineer, or small team operator responsible for one or more public web properties. The initial release is a single-instance deployment without accounts; anyone with network access to the UI/API can operate it, so deployment must be restricted to a trusted network.

**Journey:** Open dashboard → add a public URL → validate and create project → start discovery → inspect truthful run progress and candidates → review/deduplicate/verify supported candidates → select safe endpoints and configure monitoring → view real checks, health, charts, incidents, alerts → rerun discovery → compare immutable snapshots and review changes.

## 4. Scope and priority

- **MUST / P0:** URL/SSRF safeguards; projects; OpenAPI/Swagger discovery; bounded same-origin crawl; public JS reference analysis; candidate provenance/deduplication; safe verification; registry; enable/disable/pause/resume and Check Now for supported methods; scheduler/Redis/worker monitoring; stored check history; health, incidents, alerts; snapshots/change comparison; dashboard, endpoint and project workflows; system health; Docker Compose; no fake production data.
- **SHOULD / P1:** Browser/network discovery provider behind an explicit advanced, resource-bounded option; configurable safe monitoring thresholds; useful period analytics and filtering; Prometheus metrics and structured tracing/logging.
- **MAY:** Additional OpenAPI locations and provider adapters that preserve the safety contract.
- **FUTURE:** Authentication and multi-tenant identity, authenticated discovery, external alert delivery, Kubernetes, integrations, remediation, advanced compliance reporting, broad browser automation.

## 5. Functional requirements

All requirements below are **SPECIFICATION-DEFINED / REQUIRED**, not claims of existing implementation. Implementation is **IMPLEMENTATION-UNVERIFIED**.

### Projects and discovery
- **PR-001** Create, list, view, and archive/delete projects. Store a display name (default hostname), normalized public start URL, creation/update timestamps, and lifecycle state. Projects are isolated by project ID in every query and mutation.
- **PR-002** Validate HTTP/HTTPS URL and resolved addresses before *every* outbound request, including redirects and browser-originated requests. Reject unsafe schemes, credentials in URLs, private/internal destinations, and unsafe DNS/redirect changes. See `Rules.md` and `Architecture.md`.
- **PR-003** Start discovery asynchronously and return a run ID; expose persisted run state, counts, provider progress, timestamps, and bounded error summaries. Progress must derive from actual provider work, not fabricated percentages.
- **PR-004** Probe configurable common OpenAPI/Swagger locations, parse valid documents, and extract operation methods/paths and servers. Invalid documents are recorded as provider errors, not endpoints.
- **PR-005** Crawl within configured origin, depth/page/request/resource/time limits. Discover links, API-like paths, and documentation/resources; do not follow arbitrary external links.
- **PR-006** Inspect same-origin public JavaScript within limits for recognizable HTTP URL/path references and methods. Findings are candidates only.
- **PR-007** Provide an extensible browser/network discovery adapter for JS-heavy sites as optional advanced capability. It is disabled by default; it must run in a restricted isolated worker, obey URL safety and limits, and report non-guaranteed coverage.
- **PR-008** Deduplicate by deterministic canonical identity while retaining all sources, first/last-seen, confidence, and per-run evidence. Candidate and verification state must remain distinct.
- **PR-009** Verify candidates only with allowed safe requests. Do not automatically execute mutation methods such as POST, PUT, PATCH, or DELETE. Store attempt method, timestamp, status, response time, result, and safe error category. Unsupported or unsafe candidates remain explicitly unverified.
- **PR-010** Persist each completed/failed discovery run and immutable snapshot membership. Compare consecutive completed snapshots and classify NEW, REMOVED, CHANGED, UNCHANGED. Expose run history and comparison details.

### Endpoint inventory and monitoring
- **PR-011** Store endpoint project, canonical method/URL/path identity, source set, confidence/evidence, verification state, monitoring configuration/state, health, and actual last/next scheduled check.
- **PR-012** Support intervals 30s, 1m, 5m, 10m, 15m, 30m, 1h; timeout, expected status policy, consecutive-failure threshold, latency threshold; monitoring enable/disable, pause/resume, and real Check Now.
- **PR-013** Schedule checks outside request handling using scheduler → Redis queue → workers → validated HTTP client → PostgreSQL. Queue failures and retries must be bounded and visible.
- **PR-014** Store every check outcome: endpoint, timestamp, status code when available, elapsed time, success, timeout/connection/error class, response bytes, content type, and check origin (scheduled/manual/verification). Do not store response bodies by default.
- **PR-015** Calculate endpoint state HEALTHY, DEGRADED, DOWN, UNKNOWN using `Rules.md`; one failure alone cannot produce DOWN.
- **PR-016** Provide paginated/filterable endpoint list, details, configuration, recent checks, incidents, alerts, source/confidence, analytics and actual next/last check times.

### Incidents, alerts, analytics, and health
- **PR-017** Create and resolve endpoint incidents using defined failure/latency/error-rate rules. Preserve lifecycle history, severity, timestamps, duration, and deduplicate an active incident for the same endpoint/condition.
- **PR-018** Create INFO/WARNING/CRITICAL alerts for defined health and discovery events, with entity references, deduplication key, cooldown, occurrence count, and read/acknowledge state. Alerts are in-product only for this version.
- **PR-019** Calculate availability, error rate, average latency, P50/P95/P99 over 1h, 6h, 24h, 7d, and 30d using stored checks and disclosed denominator/sample count. Return “insufficient data” when no samples exist.
- **PR-020** Dashboard KPIs (projects, endpoint/health counts, active incidents, latency, availability, error rate, recent discovery changes) must be derived from API data and include the selected time window / sample context where relevant.
- **PR-021** Expose actual component health for API, PostgreSQL, Redis, scheduler, worker/queue activity, and discovery capability. Unknown/unreachable dependencies must report degraded/unavailable/unknown—not “healthy” by default.

### Frontend and system
- **PR-022** Provide Dashboard, Projects, Add Project, Discovery, Endpoints, Endpoint Details, Monitoring, Incidents, Alerts, Analytics, Discovery History, System Health, Settings. Every visible operation maps to a documented API operation; no dead controls.
- **PR-023** React + TypeScript UI with responsive, accessible data-dense operational views. Restrained cybersecurity command-center styling; optional 3D is limited to topology/project/health visualization, is backed by real data, and falls back to a 2D view when WebGL is unavailable. Do not use 3D for tables, forms, or settings.
- **PR-024** Settings show actual configured safety/resource/monitoring defaults and permit only documented configuration changes. No fake metrics, simulated discovery progress, seeded production-looking records, or fabricated system health.
- **PR-025** Run as modular Docker Compose deployment with FastAPI/Python, PostgreSQL, Redis, scheduler, workers, and frontend. Provide health endpoints and operational logs/metrics.

## 6. Hackathon delivery sequence

Frame the demo as **Open Innovation → Cybersecurity: exposed API attack-surface discovery and change monitoring**, not generic uptime monitoring. The demo must state that discovery is bounded and does not prove vulnerability.

Deliver in this dependency order, keeping one end-to-end path runnable at every milestone:
1. Add project → SSRF-safe validation → baseline OpenAPI/crawl/JS discovery.
2. Candidate normalization/deduplication → safe verification → endpoint registry and provenance.
3. Persisted monitoring configuration → scheduler/Redis/workers → actual check results and health transitions.
4. Incident/alert generation and real dashboard/history.
5. Rediscovery → immutable snapshots → accurate change comparison.
6. Multi-project analytics, measured system health, and polish/optional browser discovery/3D visualization.

Do not delay the working core path for advanced 3D, broad browser automation, Kubernetes, external integrations, or scaling work.

## 7. Core data and API requirements

Canonical database entities: `projects`, `endpoints`, `endpoint_sources` (or normalized source relation), `discovery_runs`, `discovery_snapshot_items`, `monitoring_configs`, `monitoring_results`, `incidents`, `incident_events`, `alerts`, and optional `system_health_checks`. Their relationships, indexes, and constraints are defined in `Architecture.md`.

REST API must have versioned `/api/v1` routes for projects, discovery runs, endpoints, monitoring configuration/actions, checks, analytics, incidents, alerts, and system health. Mutations validate project ownership/existence, return stable JSON error shapes, and enqueue long-running work rather than blocking. The API contract and key routes are defined in `Architecture.md`.

## 8. Security, data, and operational requirements

- **PR-026** Enforce SSRF protections before all outbound network access and at each redirect hop; resolve and pin/verify destination addresses to mitigate rebinding; reject any mixed unsafe DNS answer. HTTP(S) only, no userinfo, no internal DNS/IP, no metadata services.
- **PR-027** Apply independent request timeout, body-size, page/resource/depth, concurrency, per-host rate, queue, retry, and browser-runtime limits. Defaults and maxima are authoritative in `Rules.md`.
- **PR-028** Configure CORS with explicit deployment origins; never wildcard credentialed CORS. Validate request schemas, paginate, cap query windows, and avoid leaking network details in user-facing errors.
- **PR-029** Use structured logs with redacted URLs/query secrets and no response bodies; avoid high-cardinality Prometheus labels. Record correlation IDs in logs, not metric dimensions.
- **PR-030** No authentication components are to be added. Since the initial product has no auth, bind/restrict deployment to trusted access; do not expose the unauthenticated control plane publicly.

## 9. Acceptance criteria

1. An operator can add a valid public HTTP(S) project and receives a project/run ID; malformed, private, loopback, link-local, metadata, or unsafe redirect targets are rejected before connection.
2. A discovery run asynchronously checks documentation locations, crawls within limits, analyzes eligible JS, and stores real provider progress, errors, candidates, sources, and a snapshot. Browser discovery is clearly optional/non-guaranteed.
3. Identical method/URL candidates from multiple providers become one endpoint with all provenance. An unsupported mutation operation is not invoked automatically and remains unverified.
4. A safe endpoint can be enabled and scheduled at an allowed interval; Check Now enqueues/runs an actual validated request, persists its result, recalculates health/metrics, triggers applicable incidents/alerts, and the UI refreshes from API state.
5. One failed check does not mark an endpoint DOWN; configured consecutive failure and recovery rules produce deterministic state transitions and incident lifecycle events.
6. Analytics match stored check records and defined formulas for each supported window; zero/insufficient data is displayed honestly.
7. Two completed discovery runs produce immutable snapshots and an accurate NEW/REMOVED/CHANGED/UNCHANGED comparison; a new public endpoint is not labeled a vulnerability by that fact alone.
8. Multiple projects have isolated endpoint, discovery, monitoring, incident, alert, and analytics data.
9. The system health page reports actual dependency/worker/queue status and degrades on failed health probes.
10. Frontend controls have corresponding real APIs and no production-like hardcoded data. Compose starts documented components; no login/auth route exists.

## 10. Ambiguities and decisions

| Ambiguity | Smallest safe decision |
|---|---|
| Which candidate requests can verification/monitoring execute? | Only safe retrieval methods (GET/HEAD). Mutation methods are never auto-invoked; unsupported candidates remain unverified/unmonitorable. |
| What does “same-origin” mean with OpenAPI servers or JS absolute URLs? | Project origin is the default allowed scope. Other origins are not fetched by default; report them as out-of-scope references. |
| Are browser discovery and external notifications mandatory? | Browser discovery is an optional advanced provider, disabled by default. External notification channels are future scope; in-product alerts are required. |
| No authentication but control actions exist | No auth is implemented; deployment must remain on a trusted network. This is not represented as an internet-safe multi-user service. |
| No repository supplied | This blueprint is based on product intent only. Every implementation claim remains unverified until code is audited. |

## 11. Status vocabulary

- **SPECIFICATION-DEFINED:** Explicitly required or described by the supplied product intent.
- **IMPLEMENTATION-UNVERIFIED:** No repository evidence was inspected; do not interpret as implemented or missing in code.
- **REQUIRED / PLANNED:** Must be implemented for this product version.
- **MISSING:** Use only after an implementation audit establishes absence.
- **PARTIALLY IMPLEMENTED / IMPLEMENTED / DEPRECATED:** Use only with repository evidence.
