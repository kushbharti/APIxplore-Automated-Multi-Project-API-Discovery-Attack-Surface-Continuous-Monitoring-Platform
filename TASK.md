# APIxplore Architecture & Implementation Task Reference

This document maps the project files, components, functions, data flows, and architectural relationships across the APIxplore platform. All files and symbols documented below reflect active, implemented code in the codebase.

---

## 1. Relevant Project Files & Responsibilities

### 1.1 Discovery Pipeline (`backend/app/discovery/`)

| File | Primary Responsibility | Key Classes & Functions |
| :--- | :--- | :--- |
| `backend/app/discovery/manager.py` | Orchestrates the end-to-end discovery run; coordinates concurrent OpenAPI probing and website crawling, runs JS analysis, handles candidate deduplication, batches verification, and persists run progress. | `run_discovery`, `_run_website_discovery`, `_deduplicate_verify_and_save` |
| `backend/app/discovery/openapi.py` | Detects OpenAPI/Swagger specifications via well-known paths and HTML/script scanning (Swagger UI, ReDoc); parses JSON/YAML specifications and extracts endpoints across all HTTP methods. | `discover_openapi`, `_try_fetch_spec`, `_scan_html_for_spec_url`, `_extract_endpoints`, `_is_openapi_spec`, `OpenAPIEndpoint`, `OpenAPIResult` |
| `backend/app/discovery/crawler.py` | Performs bounded breadth-first crawl of target site using `robots.txt` and `sitemap.xml` seed heuristics; extracts links, form actions, and script URLs while discarding static assets and tracking internal paths. | `crawl_website`, `_crawl_page`, `_extract_links`, `_canonicalize`, `_classify_path`, `CrawlResult`, `CrawledURL` |
| `backend/app/discovery/javascript.py` | Fetches publicly served JavaScript bundles and extracts API endpoint patterns via regular expressions (`fetch`, `axios`, `$http`, `api`, `XHR`); infers HTTP methods (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`). | `analyze_javascript`, `extract_endpoints_from_js`, `_should_skip_path`, `JSEndpoint`, `JSAnalysisResult` |
| `backend/app/discovery/verifier.py` | Validates candidate endpoints with non-destructive HTTP requests; verifies responsiveness, classifies APIs vs. HTML webpages, inspects redirects, and handles parameter dummy substitution. | `verify_batch`, `verify_candidate`, `_classify_verification`, `_is_spa_fallback`, `_is_html_error_page`, `VerificationResult` |
| `backend/app/discovery/github.py` | Stub module for retired GitHub-specific discovery; directs callers to generic URL discovery. | `parse_github_target`, `discover_github_repo` |

---

### 1.2 Endpoint Request Schema & Dynamic Forms (`backend/app/services/` & `frontend/`)

| File | Primary Responsibility | Key Classes & Functions |
| :--- | :--- | :--- |
| `backend/app/services/endpoint_schema.py` | Extracts structured parameter schemas (path, query, header) and request body schemas for endpoints from OpenAPI specifications or URL patterns. | `get_endpoint_schema`, `fetch_spec`, `_extract_body_field`, `_resolve_ref`, `_extract_path_params_from_str` |
| `backend/app/schemas/endpoint.py` | Pydantic data schemas representing endpoint definitions, parameter fields, request bodies, and check payloads. | `EndpointSchemaOut`, `RequestBodySchema`, `BodyField`, `ParameterField`, `EndpointCheckRequest`, `EndpointOut` |
| `backend/app/api/v1/endpoints.py` | FastAPI endpoint routes; provides CRUD operations, health check history, schema inspection, and test request triggering. | `get_endpoint_schema_details`, `check_endpoint_now`, `list_endpoints`, `get_endpoint`, `create_endpoint`, `update_endpoint` |
| `frontend/src/components/HttpRequestModal.tsx` | Interactive React modal component that dynamically builds schema-driven forms for `POST`, `PUT`, `PATCH`, and `GET` requests; supports primitives, enums, nested objects, dynamic arrays, and fallback manual JSON editing. | `HttpRequestModal`, `HttpRequestForm`, `BodyFieldItem`, `validateBodyFields`, `buildDefaultFieldValue` |
| `frontend/src/components/ResponseViewer.tsx` | Response visualizer displaying HTTP status badges, latency indicators, headers table, and formatted/syntax-highlighted response bodies. | `ResponseViewer` |
| `frontend/src/pages/Endpoints.tsx` | Main endpoints management UI displaying inventory, continuous monitoring status, quick check triggers, and Request Form launchers. | `Endpoints` |

---

### 1.3 Database & Migrations (`backend/app/db/` & `backend/migrations/`)

| File | Primary Responsibility | Key Classes & Functions |
| :--- | :--- | :--- |
| `backend/app/db/session.py` | Async SQLAlchemy engine and session factory; provides connection configuration, pool sizing, health probes, and NeonDB SSL / connection pooler handling. | `parse_db_url_and_connect_args`, `_build_engine`, `get_engine`, `get_session_factory`, `get_db`, `check_db_health`, `close_engine` |
| `backend/migrations/env.py` | Alembic migration runner configured for async PostgreSQL / SQLite; applies schema migrations online and offline. | `run_async_migrations`, `do_run_migrations`, `run_migrations_offline` |
| `backend/app/core/config.py` | Application configuration and environment variable parsing via Pydantic Settings; normalizes database URLs to asyncpg. | `Settings`, `get_settings`, `validate_database_url` |
| `backend/app/models/` | SQLAlchemy declarative ORM models. | `Project`, `DiscoveryRun`, `DiscoveryCandidate`, `Endpoint`, `HealthCheck`, `Incident` |

---

### 1.4 Monitoring & Checker (`backend/app/monitoring/`)

| File | Primary Responsibility | Key Classes & Functions |
| :--- | :--- | :--- |
| `backend/app/monitoring/checker.py` | Executes active health checks against registered endpoints, supporting custom headers, query params, path parameters, and request bodies. | `run_check`, `run_monitoring_cycle`, `CheckResult` |
| `backend/app/services/endpoint.py` | Business logic for endpoint state transitions, check interval scheduling, and health state updates. | `EndpointService` |

---

## 2. End-to-End Data Flow

```mermaid
flowchart TD
    subgraph UI ["Frontend (React + Vite)"]
        A["User triggers Discovery<br/>(ProjectDetails.tsx)"]
        B["Review Candidates & Accept<br/>(ProjectDetails.tsx)"]
        C["Send Request via Dynamic Form<br/>(HttpRequestModal.tsx)"]
    end

    subgraph API ["FastAPI Backend (app/api/v1/)"]
        D["POST /projects/{id}/discovery<br/>(discovery.py)"]
        E["POST /projects/{id}/candidates/accept<br/>(discovery.py)"]
        F["GET /endpoints/{id}/schema<br/>(endpoints.py)"]
        G["POST /endpoints/{id}/check<br/>(endpoints.py)"]
    end

    subgraph Discovery ["Discovery Engine (app/discovery/)"]
        H["manager.py: run_discovery()"]
        I["openapi.py: discover_openapi()"]
        J["crawler.py: crawl_website()"]
        K["javascript.py: analyze_javascript()"]
        L["verifier.py: verify_batch()"]
    end

    subgraph Storage ["Database (NeonDB PostgreSQL / SQLite)"]
        M[("DiscoveryRun")]
        N[("DiscoveryCandidate")]
        O[("Endpoint")]
        P[("HealthCheck")]
    end

    A --> D
    D --> H
    H --> I
    H --> J
    J --> K
    I & J & K --> L
    H --> M
    H --> N
    B --> E
    E --> O
    C --> F
    F --> |Reads Schema & OpenAPI Spec| Storage
    C --> G
    G --> |checker.py: run_check()| P
    G --> |Updates last_checked_at| O
```

### 2.1 Discovery & Verification Flow
1. **Triggering**: A user triggers discovery via `POST /api/v1/projects/{id}/discovery`.
2. **SSRF & Target Check**: `manager.py` verifies the URL against SSRF constraints and checks for unsupported repository targets without deployment URLs.
3. **Concurrent Probing & Crawling**:
   - `openapi.py` concurrently checks well-known OpenAPI/Swagger locations (`/openapi.json`, `/v3/api-docs`, etc.) and UI documentation pages (`/docs`, `/swagger-ui/`).
   - `crawler.py` crawls links and extracts JavaScript references while skipping static assets.
4. **JS Analysis**: `javascript.py` downloads JS files and extracts API paths with HTTP methods (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`).
5. **Deduplication**: Candidates are merged by `(method, full_url)` with precedence given to OpenAPI, then JS, then Crawler.
6. **Verification**: `verifier.py` sends non-destructive probes (replacing `{param}` with sample values), classifying endpoints as `VERIFIED`, `AUTH_REQUIRED`, `WEB_PAGE`, or `UNAVAILABLE`.
7. **Persistence**: Candidates and summary statistics are committed to NeonDB.

### 2.2 Schema Generation & Dynamic Request Form Flow
1. **Schema Retrieval**: When opening the Request Form in `Endpoints.tsx`, `HttpRequestModal.tsx` calls `GET /api/v1/endpoints/{id}/schema`.
2. **OpenAPI / Path Introspection**: `endpoint_schema.py` matches the endpoint URL against the project's OpenAPI specification (cached in memory) to extract parameters, default values, enums, and request body field definitions.
3. **Form Generation**: `HttpRequestModal` renders structured inputs for all fields (nested objects, dynamic array items, booleans, enums). If no body schema is defined, a raw JSON editor mode is provided.
4. **Submission**: The user submits the request via `POST /api/v1/endpoints/{id}/check`.
5. **Execution & Results**: `checker.py` formats the request, dispatches it to the target service, and returns the real status code, latency, headers, and body. `ResponseViewer` renders the output.

---

## 3. Database Migration Architecture (NeonDB)

- **Driver**: `postgresql+asyncpg` for async I/O.
- **Connection Processing**: `parse_db_url_and_connect_args` in `app.db.session`:
  - Normalizes URL by stripping `sslmode`, `channel_binding`, `gssencmode`, and libpq-specific parameters to avoid driver keyword mismatch.
  - Automatically provides `connect_args={"ssl": "require"}` for Neon hosts.
  - Configures `statement_cache_size=0` for compatibility with Neon connection poolers (PgBouncer).
- **Alembic Integration**: `migrations/env.py` applies identical connection parsing to run migrations against NeonDB without external configuration hacks.
- **Active Database**: Configured directly in `backend/.env` with NeonDB direct and pooled endpoints. All local SQLite database files have been retired.

### 3.1 PostgreSQL Type Mismatch Fix (`character varying = uuid`)
- **Problem**: In PostgreSQL, `projects.id`, `endpoints.project_id`, `discovery_runs.id/project_id`, and `discovery_candidates.id/run_id/project_id` are `VARCHAR(36)`. When mapped with `UUIDMixin` or `UUID(as_uuid=False)`, `asyncpg` transmitted query parameters as `$1::UUID`. PostgreSQL threw `operator does not exist: character varying = uuid`.
- **Solution**: Created `StringUUIDMixin` in `app.models.base` and mapped all 36-character UUID columns as `String(36)`. Updated repository lookups to use string parameters, preventing invalid UUID casts.

### 3.2 Concurrency & Session Lifecycle Isolation Fix
- **Problem**: When monitoring health checks encountered errors, `IncidentManager` spawned `attempt_recovery` via `asyncio.create_task` while passing `self._repo._session`. The parent task committed and closed the session while the background task was flushing, throwing `InvalidRequestError: This session is in 'prepared' state; no further SQL can be emitted within this transaction.`
- **Solution**: Updated `attempt_recovery` to manage its own isolated `AsyncSession` when `session=None`. `IncidentManager` passes only the incident ID string without sharing sessions across concurrent tasks.

