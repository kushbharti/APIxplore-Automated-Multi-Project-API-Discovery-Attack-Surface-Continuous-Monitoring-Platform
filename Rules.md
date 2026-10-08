# Authoritative Product and Engineering Rules

**Authority:** Normative implementation rules shared by `PRD.md`, `Architecture.md`, and `Design.md`. If a conflict appears, security rules in this file take precedence; update all four documents together.  
**Implementation status:** **IMPLEMENTATION-UNVERIFIED**. These are required rules, not evidence of existing code.

Keywords **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

## 1. Core product truth

1. The product discovers and monitors a bounded view of public API attack surface; it MUST NOT claim universal or exhaustive discovery.
2. “Publicly reachable” or “newly discovered” alone is not a vulnerability. Use `EXPOSURE`, `OBSERVATION`, `ANOMALY`, `SECURITY_REVIEW_REQUIRED`, and reserve `CONFIRMED_VULNERABILITY` for separately established evidence. This release does not perform exploit validation and MUST NOT auto-assign `CONFIRMED_VULNERABILITY`.
3. Keep distinct: candidate discovery, verification result, monitoring configuration/state, health state, security observation/classification, incident lifecycle, alert state, and snapshot change classification. Do not overload one status field.
4. UI/API data MUST come from persisted/current system state. Production MUST NOT ship fabricated health, progress, metrics, alert records, endpoints, or charts. Test fixtures and explicitly isolated development mocks are permitted only outside production paths.
5. Implementation status claims require code evidence. Without repository inspection use `SPECIFICATION-DEFINED` and `IMPLEMENTATION-UNVERIFIED`; never assert `IMPLEMENTED`, `PARTIALLY IMPLEMENTED`, `MISSING`, or `DEPRECATED` without evidence.

## 2. Status enums

Persist canonical uppercase values; API returns uppercase. Unknown values are errors, not silently coerced.

| Domain | Allowed values | Meaning |
|---|---|---|
| Project | `ACTIVE`, `ARCHIVED` | Archived projects do not schedule new checks; history remains queryable. |
| Discovery run | `QUEUED`, `RUNNING`, `PARTIAL`, `COMPLETED`, `FAILED` | `PARTIAL` means usable results with provider failures/skips. |
| Provider | `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `SKIPPED` | Provider-specific real state. |
| Discovery candidate | `CANDIDATE`, `OUT_OF_SCOPE`, `REJECTED` | Raw finding disposition; it is separate from verification. |
| Verification | `NOT_ATTEMPTED`, `VERIFIED`, `UNAVAILABLE`, `INVALID`, `BLOCKED` | `VERIFIED` only after permitted request receives a response meeting verification criteria. |
| Source | `OPENAPI`, `CRAWLER`, `JAVASCRIPT`, `BROWSER`, `MANUAL` | Store all applicable sources per logical endpoint. |
| Monitoring | `ENABLED`, `DISABLED`, `PAUSED`, `UNSUPPORTED` | `PAUSED` retains enabled intent/config but suspends scheduling; unsafe methods are `UNSUPPORTED`. |
| Health | `HEALTHY`, `DEGRADED`, `DOWN`, `UNKNOWN` | Derived by rules below. |
| Check origin | `SCHEDULED`, `MANUAL`, `VERIFICATION` | Distinguishes evidence origin. |
| Incident | `DETECTED`, `INVESTIGATING`, `ONGOING`, `RESOLVED` | Lifecycle rules in §10. |
| Severity | `INFO`, `WARNING`, `CRITICAL` | Same values for alerts; incidents use `WARNING`/`CRITICAL` as needed. |
| Alert state | `OPEN`, `ACKNOWLEDGED`, `RESOLVED`, `SUPPRESSED` | `SUPPRESSED` may be represented as an event/counter if no alert row is emitted. |
| Snapshot change | `NEW`, `REMOVED`, `CHANGED`, `UNCHANGED` | Compared only for completed/partial usable snapshots. |
| Security classification | `EXPOSURE`, `OBSERVATION`, `ANOMALY`, `SECURITY_REVIEW_REQUIRED`, `CONFIRMED_VULNERABILITY` | Last classification requires evidence outside mere public reachability; not auto-created here. |

## 3. URL, DNS, SSRF, and HTTP rules

### 3.1 URL validation

- Accept only absolute `http://` or `https://` URLs. Reject `file`, `ftp`, `gopher`, `data`, `javascript`, `ws`, and all other schemes.
- Reject userinfo (`user:pass@`), control characters, malformed/ambiguous host syntax, empty host, invalid ports, fragments as request targets, and non-canonical IP encodings. Strip fragments before any identity or request calculation.
- Normalize hostname with IDNA and lowercase; normalize default ports away; normalize path dot-segments and percent-encoding safely without changing reserved delimiters; retain query only when it is materially part of endpoint identity and redact it in logs/UI where it may contain secrets.
- Project origin is normalized `(scheme, host, effective port)`. Crawl and provider fetch defaults are same-origin only. References to other origins are out-of-scope and MUST NOT be fetched unless an explicit future allowlist feature is added.

### 3.2 Destination validation before every request

Before every outbound connection—including each redirect hop, browser request, OpenAPI server, JS resource, verification, scheduled check, manual check, and retry—MUST:
1. Parse/normalize URL and check scheme/method/port policy.
2. Resolve A and AAAA. Fail closed for resolution errors, any unsafe answer, mixed public/private answers, or address changes that do not match the active pin.
3. Reject IPv4/IPv6 loopback, private, link-local, unspecified, multicast, reserved/non-routable ranges, IPv4-mapped unsafe IPv6, localhost names and subdomains, internal service names, and known cloud metadata hosts/IPs (including link-local metadata address ranges).
4. Bind the actual socket to a validated address while preserving Host/SNI hostname and certificate validation. Do not allow an HTTP library to perform an unvalidated second DNS lookup. Revalidate on connection/retry to mitigate DNS rebinding.
5. Disable automatic redirects; cap at 5 hops. Every `Location` is resolved relative to current URL and undergoes the complete process. Reject redirect to unsafe address, different origin by default, unsupported scheme, or redirect loop.
6. Apply limits in §6. TLS verification MUST stay enabled. No proxy environment variable may silently route around the policy.

Safety policy rejection yields verification `BLOCKED` or a check outcome `policy_blocked`; it is not an endpoint vulnerability finding. Save only safe normalized diagnostic detail.

### 3.3 Methods and response handling

- Automated discovery, verification, and monitoring MUST use only `GET` or `HEAD`. `HEAD` may fall back to `GET` only if fallback is bounded and policy allows; default is use discovered safe method or GET. Do not execute `POST`, `PUT`, `PATCH`, `DELETE`, arbitrary OPTIONS, form submissions, or methods inferred from OpenAPI operations.
- A logical endpoint may describe an unsafe method but stays `NOT_ATTEMPTED` and monitoring `UNSUPPORTED` unless a future explicitly authorized safe strategy is defined. Do not silently probe a different method and report it as verification of the unsafe operation.
- Do not store response bodies by default. Capture bounded status, selected safe headers (content type), byte count and elapsed time. Avoid cookies/authorization headers; send no credentials.

## 4. Discovery and crawling rules

- Required baseline: OpenAPI/Swagger, constrained same-origin crawl, public JavaScript analysis. Browser/network provider is optional, advanced, disabled by default, isolated, and non-guaranteed.
- Probe these paths by default, relative to project origin: `/openapi.json`, `/swagger.json`, `/api-docs`, `/v3/api-docs`, `/swagger/v1/swagger.json`. Provider configuration may add paths; it MUST NOT add unsafe hosts or methods.
- Crawl only HTTP(S) same-origin links/resources. No unrestricted external-link crawl, forms, credentialed routes, or unbounded query fuzzing. Track visited normalized URLs to avoid loops.
- Default limits (configurable downward or by trusted operator within hard ceilings): depth 3; 100 HTML/document pages per run; 50 JS resources; max 2 MiB per fetched discovery response; total 50 MiB per run; 5 s request timeout; 2 concurrent requests per origin and 5 per project; minimum 1 request/second per origin; 5 redirect hops. A hard global worker concurrency cap also applies.
- Only parse expected content types or bounded text sniffing. Enforce decompressed-size limits to prevent compression bombs. Fail fast on malformed/oversized documents; record provider error.
- JS matching is static best-effort. Do not execute JS in baseline provider; discovered URLs/methods are candidates, never verified by the parser.
- Browser provider limits: isolated container; same-origin navigation by default; at most 5 minutes and 10 pages per run (initial ceilings); intercept every network request through SSRF policy; block downloads, popups, service-worker escape paths, file access, and internal network. Label source `BROWSER` and state limits in UI.
- Provider failure is not equivalent to “no endpoints.” Preserve provider errors and disclose incomplete coverage.

## 5. Endpoint identity, deduplication, verification

### 5.1 Canonical identity

Canonical endpoint key = `project_id + normalized method + normalized absolute URL`, where method is uppercased and the target URL uses project-origin-normalized scheme/host/effective port, normalized path, and query policy. Default query identity: remove known volatile tracking parameters (`utm_*`, `gclid`, `fbclid`); retain other query key/value pairs, sorted by key then value, because query may change resource semantics. Never merge distinct HTTP methods. Strip fragment. Normalize trailing slash only for root path equivalence; do not collapse arbitrary path slashes or case-sensitive path segments.

Store stable canonical key/hash plus normalized URL and display URL. All providers map into this identity. A collision must be reviewed/tested; do not deduplicate solely by path when origins/methods differ.

### 5.2 Provenance and confidence

- One endpoint row per project/canonical key; source relation contains every source and first/last-seen per source.
- Confidence is evidence quality, not exploit likelihood. Suggested deterministic bands: `HIGH` explicit parsed OpenAPI operation or observed browser request; `MEDIUM` literal JS request pattern or crawl-discovered API-like link; `LOW` weak heuristic. Persist reasons/evidence; never infer confidence from a successful status alone.
- Preserve candidate, verification, security classification, and monitoring state independently.

### 5.3 Verification lifecycle

- New candidate starts `NOT_ATTEMPTED`. Verification is a safe GET/HEAD request only, validated under §3. A returned HTTP response confirms reachability of the attempted safe resource: `VERIFIED` if response is not a policy failure and endpoint URL/method semantics were actually tested; status 4xx may be `VERIFIED` as reachable but not successful application operation. Store status and response time.
- DNS/connection/TLS/timeout failure after policy validation: `UNAVAILABLE`. A malformed/non-endpoint reference or non-HTTP content that fails explicit parser/endpoint criteria: `INVALID`. Policy reject, unsafe method, out-of-scope origin, or security-control block: `BLOCKED` (unsafe-method candidates may instead retain `NOT_ATTEMPTED` with reason; do not label as attempted).
- Retry verification only on explicit rerun/manual action or scheduled discovery policy, with bounded attempts. Preserve latest state and historical evidence; do not claim verified when no safe request was completed.

## 6. Limits, rate, and concurrency defaults

The following are safe initial ceilings; deployment may tighten them. Raising a ceiling requires explicit security review and documentation.

| Limit | Default / ceiling |
|---|---|
| Monitoring request timeout | default 10 s; allowed 1–30 s |
| Discovery request timeout | 5 s default, hard ceiling 15 s |
| Response body | monitor 1 MiB; discovery 2 MiB per response, 50 MiB total/run; decompressed bytes count |
| Redirects | max 5 per request |
| Origin rate | at most 1 request/s/origin by default, shared across jobs |
| Concurrency | 2/origin; 5/project; global cap configured at deployment |
| Crawl | depth 3, 100 pages, 50 JS files per run |
| Browser | disabled default; 5 min and 10 pages/run |
| API request | body cap 1 MiB; list page size default 50, max 200 |
| Discovery/Check Now | per-project admission control; queue backlog bounded; return `429`/`503` rather than unbounded enqueue |
| Worker retries | max 2 transient retries with backoff; no retry of policy rejection or permanent parse error |

These bounds are enforced server-side and in worker/network code—not only in UI controls.

## 7. Monitoring configuration and scheduling

- Supported interval seconds: 30, 60, 300, 600, 900, 1800, 3600. Reject any other interval.
- Default monitoring: disabled until explicitly enabled or user selects “Start Monitoring” after discovery. A project or discovery run does not silently schedule every candidate.
- Default timeout 10 s; expected HTTP status is 200–399 inclusive after allowed redirects; default consecutive failure threshold 3; default latency threshold 2000 ms. Configuration is per endpoint unless an explicit project default is applied to endpoints at enable time.
- Scheduled checks use `next_check_at` persisted in PostgreSQL. `last_check_at` is derived from the latest completed scheduled or manual check and labeled with origin where useful. Scheduler computes actual times; UI never fabricates them.
- Pause suspends scheduling without deleting config/history. Disable suspends and clears next check. Resume/enabling sets `next_check_at` to now or now + interval per documented operation; default: now, then normal interval after dispatch. Check Now bypasses schedule but uses same limits and is never simulated.
- Schedule jobs are idempotent per endpoint/due slot. Stale jobs re-check that config remains enabled/unpaused and endpoint is supported before making a request.
- A manual check records a result and updates health/incidents/alerts but does not move scheduled due time by default.

## 8. Monitoring result and health calculations

### 8.1 Check success

A check is successful iff policy allows the request, connection/TLS completes, no timeout/transport error occurs, and final HTTP status is within configured expected range (default 200–399). If status is missing or outside expected set/range, `success=false`. Record a distinct failure class (`http_status`, `timeout`, `dns_error`, `connection_error`, `tls_error`, `policy_blocked`, `response_too_large`, `other`). Policy-blocked jobs should generally be `BLOCKED`, not interpreted as target downtime; exclude them from availability denominator and raise a security/system event if appropriate.

### 8.2 Health transitions

State is calculated from completed eligible results in chronological order, not a single client response. Initial state `UNKNOWN` until one eligible check completes.

| Condition | Resulting state |
|---|---|
| No eligible result has completed | `UNKNOWN` |
| First eligible result succeeds with latency at/below threshold and endpoint has never been DOWN | `HEALTHY` |
| Latest result succeeds with latency at/below threshold after a prior DOWN, but only 1 consecutive success has occurred | `DEGRADED` (recovery pending) |
| Two consecutive successful eligible checks after a prior DOWN, both with latency at/below threshold | `HEALTHY` |
| One or two consecutive failures below configured failure threshold (default 3) | `DEGRADED` |
| Consecutive failures reach configured failure threshold (default 3) | `DOWN` |
| Successful result with latency above threshold | `DEGRADED`; one high-latency sample is enough for degraded state, but incident requires sustained threshold rule below |
| A successful, within-threshold result follows a degraded state that was caused only by latency (not DOWN) | `HEALTHY`, unless another configured condition still makes it degraded |
| No new result while disabled/paused | Retain last computed health; use `UNKNOWN` only if no eligible result has ever completed |

A successful response with latency above configured threshold does not reset failure streak for incident purposes only if it is also an HTTP failure; success streak and failure streak are mutually reset by outcome. Health is `HEALTHY` only when latest result succeeds, latency is within threshold, and recovery requirement is met. Paused/disabled endpoints retain last computed state with monitoring state clearly shown; do not change to UNKNOWN merely because monitoring was paused.

### 8.3 Analytics formulas

For selected window, include eligible scheduled/manual checks completed within `[now - period, now]`; exclude policy-blocked and verification checks. Show sample count and exclude checks with no latency from latency percentiles only.

- Availability = successful eligible checks / all eligible checks × 100.
- Error rate = failed eligible checks / all eligible checks × 100.
- Mean latency = arithmetic mean of available response times.
- P50/P95/P99 = nearest-rank percentile over available response times: sorted ascending, rank `ceil(p*n)`, 1-indexed.
- If denominator is zero, availability/error rate are `null` / “No data”, not 0%/100%. If latency samples are empty, latency metrics are null. A chart must not draw a misleading zero line for missing samples.
- Project/global aggregate formulas are based on pooled eligible check counts, not average of endpoint percentages. Latency percentiles pool raw latency samples within bounded period.

## 9. Incident rules and lifecycle

Incident conditions are deterministic and per endpoint/condition key. Initial required conditions:

- `ENDPOINT_DOWN`: create when health transitions to DOWN (failure threshold reached). Severity CRITICAL.
- `SUSTAINED_HIGH_LATENCY`: create when at least 3 of the last 5 eligible successful checks exceed configured latency threshold within 15 minutes. Severity WARNING; if endpoint also DOWN, avoid duplicate latency incident.
- `HIGH_ERROR_RATE`: create when at least 10 eligible checks in a rolling 15-minute window exist and error rate is at least 20%. Severity WARNING, or CRITICAL if endpoint is DOWN. This rule is a default product threshold; expose it read-only in settings unless a documented setting is added.

Lifecycle:
1. On trigger, create one active incident in `DETECTED`, record first event and evidence (check IDs/window/counts).
2. Operator may transition `DETECTED → INVESTIGATING`; no automatic transition over operator state.
3. If trigger remains true on subsequent evaluation, transition `DETECTED` or `INVESTIGATING` to `ONGOING` only when at least one subsequent evaluation confirms condition (if `INVESTIGATING`, preserve user intent in event history and allow status to `ONGOING`).
4. When recovery condition clears (DOWN: two consecutive successful checks; latency/error-rate: condition false for two consecutive evaluations), transition active incident to `RESOLVED`, record `resolved_at`, duration, and recovery evidence.
5. `RESOLVED` is terminal. A later recurrence creates a new incident. At most one active incident per `(endpoint, condition_key)`.
6. Invalid status transitions return validation error. Project archive does not silently resolve active incidents.

## 10. Alert rules, dedupe, cooldown

Required event types: `ENDPOINT_DOWN`, `HTTP_5XX`, `TIMEOUT`, `HIGH_LATENCY`, `HIGH_ERROR_RATE`, `CONSECUTIVE_FAILURES`, `RECOVERY`, `NEW_ENDPOINT`, `REMOVED_ENDPOINT`, `DISCOVERY_FAILURE`. Each alert includes severity, project/related entity, first/last occurrence, count, dedupe key and state.

- Severity mapping: discovery completion/new/removed = INFO; repeated failures, 5xx, timeout, discovery partial/failure, high latency/error = WARNING; endpoint DOWN = CRITICAL; recovery = INFO.
- Dedupe key = event type + endpoint ID (or project ID/run ID for project-level event) + condition identity. Do not include volatile request IDs.
- Cooldown default 15 minutes per dedupe key. During cooldown, update `last_occurrence_at` and occurrence count on the existing open/acknowledged alert; do not create another alert row. After cooldown, emit/reopen according to prior state while retaining history.
- Recovery emits a distinct INFO alert once per incident/condition resolution; repeated recovered checks do not repeat it.
- Acknowledging an alert is not incident resolution. Alert acknowledgement is an operator action; only condition resolution/system event resolves condition alerts. Discovery alerts may be resolved by acknowledgement or subsequent run according to alert type.
- Suppression must be observable via a counter/log; do not silently drop events.

## 11. Snapshot and change rules

- A snapshot is the immutable set of logical endpoint keys observed in one `COMPLETED` or usable `PARTIAL` run, with captured canonical method/URL, safe display attributes, source set, confidence, and verification state at snapshot time.
- Do not compare failed runs or snapshots with zero provider coverage as a valid empty surface. Mark comparison unavailable when all providers failed/skipped; never report every endpoint as REMOVED from a failed crawl.
- Compare current run against the immediately previous comparable completed/partial snapshot for that project. First valid snapshot: all entries `NEW` relative to no baseline; UI labels “initial baseline,” not a change alert unless policy says so (default: no NEW alerts for initial baseline).
- Key absent previously/present now → `NEW`; present previously/absent now → `REMOVED`; key present in both but tracked attributes changed → `CHANGED`; otherwise `UNCHANGED`.
- Tracked change attributes: method/normalized target, expected safe endpoint metadata if available, source set, and documented API operation shape. Source addition alone is a provenance update, not necessarily a surface change; report source delta separately. Verification/health changes are not snapshot endpoint changes.
- Preserve removed records/tombstones in comparison history. Do not delete historic check or incident data due to endpoint disappearance.
- Newly discovered/public endpoint gets `EXPOSURE` or `OBSERVATION` classification as appropriate, never vulnerability solely by being new/public.

## 12. Database, API, and integration rules

- PostgreSQL is source of truth; all timestamps UTC `timestamptz`; UUID primary keys; FK constraints; unique endpoint canonical key per project; unique snapshot key per run; one monitoring config per endpoint; partial unique active incident condition.
- Every project-scoped read/write filters by project relation. Client-supplied project IDs never override endpoint ownership. Use transactions for endpoint/result/state/event writes.
- Queue payloads contain IDs and due metadata, not untrusted target URLs as authority. Worker reloads canonical endpoint/config from DB and revalidates target at execution time.
- API route and response fields must be documented in `Architecture.md`. UI cannot be sole validator; backend validates every mutation.
- Long actions return `202` plus durable run/check identifiers; UI polls server state. Use a stable error envelope, proper HTTP status, bounded pagination, supported analytics periods only.
- Settings may not expose controls that permit breaking SSRF protections. Security hard limits cannot be disabled by ordinary app configuration.
- No authentication endpoints/middleware/pages/tokens are allowed. Restrict by deployment network policy; never call lack of auth “secure for public exposure.”

## 13. Frontend, accessibility, errors, logs, observability

- React UI is a view/controller; backend owns authoritative discovery, schedule, health, percentiles, incident/alert, and snapshot calculations.
- Every button must map to a live API action or be clearly disabled with reason; all mutation flows show pending, success, failure and refresh canonical state.
- Empty, stale, loading, partial, and error states are distinct. Never substitute example data in production when an API fails.
- Use keyboard-operable controls, visible focus, semantic headings/tables, accessible names, text labels for color-coded states, reduced-motion support, and chart text summaries.
- Structured logs redact query values/secrets, cookies, headers and bodies; no raw stack trace or internal resolver response to client. Do not persist or emit sensitive request data.
- Metrics must be low-cardinality; no full URLs, endpoint/project IDs, request IDs as labels. Use histograms/counters/gauges as suited; keep correlation identifiers in logs/traces only.
- System health must be measured from real dependency probes, scheduler heartbeat/lag, queue age/depth and worker heartbeat. A running API process does not establish healthy workers.

## 14. Explicit prohibitions

The system MUST NOT:

- Claim to find all APIs or to have comprehensive coverage.
- Label a publicly reachable or newly discovered endpoint a confirmed vulnerability without sufficient independent evidence.
- Send credentials, execute unsafe HTTP methods, submit forms, fuzz parameters, exploit, brute force, or mutate target state.
- Follow redirects or DNS answers without revalidation; contact localhost, private/internal/link-local/reserved targets, cloud metadata, or unsafe schemes.
- Crawl without bounds, bypass per-origin rate/concurrency limits, or run blocking discovery/checks in normal API request handlers.
- Mark health DOWN after one failure or invent `last_check`/`next_check` values.
- Treat queue delivery as persistence, drop failed jobs silently, or lose historical snapshot/result/incident evidence without an explicit retention policy.
- Count policy-blocked requests as target downtime or include them as availability failures.
- Generate hardcoded production metrics, simulated progress, fake alerts, static “healthy” dependencies, or nonfunctional controls.
- Introduce login, registration, logout, tokens, password hashing, auth middleware, protected routes, or auth pages/API calls.
- Add unnecessary microservices, Kubernetes requirement, AI/ML, third-party integrations, or unrelated features to the initial release.
