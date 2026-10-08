# UX / UI Design Specification

**Product:** Automated Multi-Project API Attack Surface Discovery & Security Monitoring Platform  
**Source of truth:** Align with `PRD.md`, `Architecture.md`, and `Rules.md`. All displayed operational data must be real backend data.  
**Implementation status:** **IMPLEMENTATION-UNVERIFIED**.

## 1. Design intent and principles

1. **Security clarity over spectacle.** Make public exposure, verification confidence, health, incidents, and discovery changes visually distinct. Do not imply that “exposed” means “vulnerable.”
2. **Truthful operations.** Show real timestamps, sample counts, source coverage, stale/partial states, and backend errors. Never render production-looking sample values when the API has no data.
3. **Dense data, calm hierarchy.** Use a premium, restrained cybersecurity command-center style: deep graphite/navy surfaces, high-contrast text, disciplined teal/blue accents, and red/amber only for meaningful severity/state. Keep tables/forms/settings conventional and efficient.
4. **Progressive enhancement.** 3D is reserved for topology, project/health visualization, and discovery overview; it is decorative context backed by real entities, never the only way to understand data. WebGL absence, poor performance, reduced motion, or unsupported devices must degrade to a clear 2D visualization.
5. **Accessible and responsive.** Keyboard-first interactions, visible focus, semantic structure, text alongside color, scalable type, chart summaries, reduced motion, and layouts usable from 320 px upward.
6. **Actionable affordances.** Every enabled control corresponds to a live, documented backend capability. Clearly distinguish read-only values, editable settings, and unsupported operations.

## 2. Application shell and navigation

### Desktop layout
- Persistent left sidebar, approximately 240–264 px, collapsible to icon rail; content area fills remaining viewport.
- Header contains current page title/breadcrumb, project context selector or “All projects,” selected analytics window where relevant, refresh/last-updated status, and non-blocking system health indicator.
- Main content uses a 12-column grid, consistent spacing scale, and max-width for long forms. Avoid card-in-card nesting.
- Navigation order: **Overview** (Dashboard), **Projects**, **Discovery**, **Endpoints**, **Monitoring**, **Incidents**, **Alerts**, **Analytics**, **Discovery History**, **System Health**, **Settings**.
- No avatar/login/logout/auth affordance. If deployment is unsecured for user convenience, the UI must not imply individual identity.

### Mobile and tablet
- Sidebar becomes a labeled drawer with accessible menu button; current page remains obvious.
- Header prioritizes title, project selector, and status. Secondary controls move into an overflow menu.
- Wide data tables switch to compact cards or horizontal scroll with pinned endpoint/method columns; never hide critical status or action labels.
- Charts stack vertically. 3D becomes 2D or is omitted at narrow widths/low-power preferences.

## 3. Navigation and page map

| Page | Purpose | Primary data/actions |
|---|---|---|
| Dashboard | Cross-project attack-surface and operations summary | Real KPIs, recent changes/incidents, project overview |
| Projects | Manage project inventory | Create, view, archive; discovery entry point |
| Add Project | Safely register public URL | Validate and submit project URL/name |
| Discovery | Inspect active/recent run and findings | Start/rerun, provider progress, errors, results |
| Endpoints | Search/filter all or project-scoped inventory | Safe state/config actions; open details |
| Endpoint Details | Single endpoint evidence, health and history | Check now, configure, analytics, checks/incidents/alerts |
| Monitoring | Operational overview and configuration | Enable/pause/resume, interval, thresholds, next checks |
| Incidents | Investigate condition lifecycle | Filter, inspect evidence, transition allowed status |
| Alerts | Review deduplicated event stream | Filter, inspect, acknowledge/resolve where supported |
| Analytics | Compare performance/availability periods | Select period/project; inspect sample-backed charts |
| Discovery History | Audit prior runs and surface comparisons | Select run, inspect providers and diffs |
| System Health | Check actual service components | Component health, last probe, queue/worker/scheduler signals |
| Settings | Inspect safe defaults and documented controls | Configured limits, monitoring defaults, CORS/deployment hints as read-only or supported |

## 4. Visual system and state language

### Color and labels
- Neutral canvas: dark graphite/navy; raised panel one step lighter; borders muted and subtle. Keep text contrast at WCAG AA or better.
- Teal/blue: neutral informational and healthy states; do not use neon gradients for every element.
- Green `HEALTHY`, amber `DEGRADED` / `WARNING`, red `DOWN` / `CRITICAL`, gray `UNKNOWN`/disabled, blue `INFO`. Pair every color with text/icon, never color alone.
- Security classification badge is separate from health badge: `EXPOSURE`, `OBSERVATION`, `ANOMALY`, `SECURITY REVIEW REQUIRED`. `CONFIRMED VULNERABILITY` must not appear unless backend evidence explicitly supports it.
- Verification uses distinct labels: `NOT ATTEMPTED`, `VERIFIED`, `UNAVAILABLE`, `INVALID`, `BLOCKED`. Source chips: OpenAPI, Crawler, JavaScript, Browser, Manual.
- Severity uses icon + label; status badges include concise text and accessible tooltip/description.

### Typography and controls
- Use a readable UI sans-serif with tabular numerals for metrics, monospace only for methods/paths/IDs where it improves scanning.
- Buttons have primary, secondary, quiet, and destructive variants; minimum touch target 44×44 px on touch layouts.
- Focus ring is prominent and not color-only. Disabled actions provide reason through adjacent text or tooltip accessible on keyboard.

## 5. Page specifications

### 5.1 Dashboard
- Header: “Attack Surface Overview,” All Projects selector, period selector (1h/6h/24h/7d/30d), data freshness timestamp.
- KPI row: total projects, endpoints, HEALTHY/DEGRADED/DOWN/UNKNOWN counts, active incidents, availability, average latency, error rate, recent discovery changes. Show period, numerator/sample count or explanatory tooltip as relevant.
- Main row: project health list with each project’s endpoint counts and last completed discovery; recent attack-surface changes with NEW/REMOVED/CHANGED labels; active incident list by severity.
- Optional restrained 3D/2D project topology visualization: nodes represent actual projects/endpoints and status; clicking navigates to real project/endpoint details. It must be labeled as an overview—not a complete network map—and have a semantic list alternative.
- Initial empty state invites “Add project”; partially failed API displays data error/last-known timestamp, not zeros masquerading as real metrics. Zero is shown only when the server returns zero.

### 5.2 Projects
- Searchable table/cards: name, normalized host, active/archive state, endpoint totals by health, last discovery completion, active incidents, actions.
- Actions: open, run discovery, archive with confirmation. No delete that silently erases history.
- Project row links all project data using real server IDs. Empty state explains how to add a public URL.

### 5.3 Add Project
- Short form: required project URL, optional display name. Helper text: public HTTP(S) site only; internal/private targets are blocked; discovery is bounded and best-effort.
- Validate on server. Client-side validation is advisory only. Show inline field errors without exposing resolver/internal network details.
- Submit creates project; next screen offers “Start discovery.” Do not claim target safety based solely on client validation.
- Pending state prevents duplicate submit. If SSRF policy blocks, show neutral safe explanation and do not echo sensitive IP/DNS detail.

### 5.4 Discovery
- Run header: run ID shortened, project, status (`QUEUED/RUNNING/PARTIAL/COMPLETED/FAILED`), started/completed timestamps, elapsed duration, trigger.
- Provider status rows for OpenAPI, Crawler, JavaScript, optional Browser: pending/running/completed/failed/skipped, actual processed/request counts where available, bounded error summary. No invented percentage. A percentage is permitted only if provider exposes a real determinate denominator; otherwise use indeterminate progress spinner and counts.
- Result summary: candidates, unique endpoints, verified, unavailable, not attempted/blocked, new/removed/changed/unchanged, discovery coverage limitations.
- Candidate table shows method, URL/path, source chips, confidence with rationale, verification state/status code/latency, monitoring eligibility. Filter by source, verification, change, confidence; search endpoint text.
- Actions: rerun discovery, open endpoint, enable monitoring for supported candidates. Unsafe methods remain visibly unsupported with explanation. Browser provider is labeled optional and non-guaranteed.
- Partial/failure state explicitly explains which providers failed and preserves successful results. No-results is not conflated with provider failure.

### 5.5 Endpoints
- Filter toolbar: project, health, verification, monitoring, source, security classification, search by path/host, method, sort, period where needed.
- Columns: method, endpoint, health, verification, latency, availability, error rate, sources, confidence, monitoring state/interval, last check, next check, actions. At smaller widths, prioritize method+endpoint, health, verification, monitor state and menu actions.
- Latency/availability/error fields include selected window/sample context, or a dash with “No data.” Last/next check is server timestamp, timezone-aware, and distinguishes “Not scheduled,” “Paused,” “Unsupported,” and “Unknown.”
- Row actions: view, Check Now, enable/disable/pause/resume, configure. Confirmation for changes with impact; Check Now returns actual queued/running/completed state and result.
- Search, filters, pagination, sort are server-backed for large inventories; clear filters resets predictably.

### 5.6 Endpoint Details
- Summary: method + URL, project link, separate health/verification/exposure badges, confidence and source evidence, first/last discovered.
- Monitoring panel: enabled/paused/unsupported, interval, timeout, expected status, failure/latency thresholds, last/next check, configure and Check Now.
- Metrics strip: current health, availability, error rate, mean/P95/P99 latency with period and sample count.
- Charts: latency, availability, error rate over selected period. Missing samples are gaps; axes/units and accessible summaries included. Do not chart a line between unrelated missing data without indication.
- Tabs/sections: Overview, Recent Checks, Incidents, Alerts, Discovery History. Tables are paginated; check rows show timestamp, origin, response/status, latency, result/error class.
- Show security observations separately from operational health. Any “review required” state includes evidence and reason, not an unsupported conclusion.

### 5.7 Monitoring
- Overview: enabled/paused/unsupported counts, health counts, due/overdue schedule signal, recent failure trend, with real backend freshness.
- Endpoint config table with bulk selection only for safe shared settings and a confirmation summary. Supported intervals exactly: 30s, 1m, 5m, 10m, 15m, 30m, 1h. Timeout 1–30 seconds. Thresholds are numeric and validated server-side.
- Controls: Enable, Disable, Pause, Resume, Check Now. Show result state after action and refresh from API. No button that only animates or alters local status.

### 5.8 Incidents
- Table/list: severity, project, endpoint, condition, status, started, duration, last event. Filters by severity/state/project/time; search.
- Detail panel/page: description, triggering rule, evidence window and check references, event timeline, status history, resolution evidence. Allowed transitions only; clearly distinguish acknowledge/assignment (not in scope unless a route exists) from lifecycle transition.
- Empty state distinguishes “No active incidents” from “No monitoring samples yet.”

### 5.9 Alerts
- Event feed: severity, event type, project/endpoint/run, first/last occurrence, occurrence count, alert state, dedupe/cooldown hint.
- Filters by state/severity/type/project/time. Detail explains trigger and related incident/run. Acknowledge/resolve only when supported by API. Cooldown aggregation is visible (“repeated N times”), not silently omitted.
- In-product alerts only in this version; do not show nonfunctional email/Slack destinations.

### 5.10 Analytics
- Period picker 1h, 6h, 24h, 7d, 30d and project/endpoint scope.
- Cards/charts: availability, error rate, latency mean/P50/P95/P99, check volume, failure classes. Every chart includes interval, source scope, sample count, units, and accessible text/table alternative.
- Multi-project availability/error metrics pool check counts as defined by backend; explain aggregation. Missing/insufficient data shown as “No data” or sample warning, never zero-filled.
- Avoid client-side recomputation that diverges from backend; API provides aggregate and series values.

### 5.11 Discovery History
- Run history table: start/end, status, source/provider coverage, endpoint/verified/unavailable counts, new/removed/changed/unchanged, errors.
- Selecting a run opens immutable snapshot summary and comparison with previous comparable run. First run is labeled baseline; failed/no-provider run says comparison unavailable.
- Diff view shows method/path, source deltas, verification status at capture time and classified change. Distinguish endpoint surface change from source-only/health/verification change.

### 5.12 System Health
- Component cards for API, PostgreSQL, Redis, scheduler, worker/queue, discovery engine and optional browser worker. Each includes actual state, checked time, safe detail, latency/backlog where available.
- States: Healthy, Degraded, Unavailable, Unknown; stale probes marked stale. Show queue depth/oldest job age, scheduler lag and worker heartbeat from measured backend data.
- Never display a static “Healthy” label. Failure message should be useful without exposing credentials, host internals, or stack traces.

### 5.13 Settings
- Read-only summary of deployment mode, permitted URL scheme/scope, crawl and body limits, rate/concurrency caps, supported intervals, timeout/failure/latency defaults, CORS/deployment guidance, browser-provider availability.
- Editable setting only when backend route and validation are defined. Hard security controls cannot be disabled here. Explain that no user authentication exists and instance access must be restricted to a trusted network.
- No account, password, token, or notification integration settings.

## 6. Shared interaction patterns

### Tables, search, filter, pagination
- Use sticky header on long desktop tables, explicit sort direction, accessible row actions, and visible active filter chips.
- Keep server and UI filter state consistent in URL query parameters only for nonsensitive filters. Paginate server-side; preserve filters on return from details.
- Empty result after filters offers “Clear filters”; truly empty collection has task-specific next step.

### Forms and modals
- Inline validation, associated labels/help/error text, safe defaults and explicit units. Avoid asking user to provide endpoint paths manually as a substitute for discovery.
- Destructive archive actions use confirmation dialog with consequences; non-destructive configuration may use a side panel. Focus moves into modal and returns to trigger on close.
- Do not show raw server errors; map stable error codes to plain-language messages.

### Loading, progress, and freshness
- Initial data load: skeletons sized like final content; refresh: non-blocking indicator.
- Long discovery/check: actual persisted state polling; unknown duration uses indeterminate progress. Show last successful refresh and stale-data notice when appropriate.
- Queue action acceptance is not completion. Clearly distinguish `Queued`, `Running`, and result states.

### Success, errors, and confirmations
- Success toast confirms the server accepted/completed the action and links to the resulting entity. For `202`, say “queued,” not “finished.”
- Errors remain actionable: validation, SSRF policy block, rate limit, unavailable dependency, target timeout, and server error are distinct. Retry only when appropriate; do not suggest bypassing a safety block.
- Confirmation precedes archive, disable bulk monitoring, or other actions with meaningful impact. Check Now does not need confirmation but must respect throttles.

## 7. Responsive and accessible behavior

- Breakpoints around 1200 px (desktop), 768 px (tablet), 480 px (mobile), adjusted to actual content rather than rigid device assumptions.
- Minimum 320 px viewport; no page-level horizontal overflow. Dense tables may use contained horizontal scroll with accessible hint and preserved key identifiers.
- Keyboard navigation through sidebar, filters, table actions, dialogs, and charts; logical focus order and visible focus rings.
- Use semantic `table` for tabular data and heading hierarchy; chart controls have labels, values, and downloadable/visible data table where practical.
- WCAG 2.2 AA target: contrast, text resizing, touch targets, error identification, status announcements, focus visibility. Use `aria-live` for run/check status updates without announcing every poll.
- Honor `prefers-reduced-motion`; avoid flashing/pulsing incident indicators. Motion is short, purposeful, and never required to understand state.

## 8. 3D / topology specification

- 3D is optional enhancement, never a required data surface. Use only for project-to-endpoint topology, discovery activity overview, and project health visualization. Do not use for tables, forms, settings, or complex incident timelines.
- Nodes/edges must be generated from real projects, endpoints, source relations, and current health data. No decorative fake attack paths, vulnerability arcs, or unobserved network relationships.
- Provide a labeled 2D alternative (list/map) with same entities, filters, and navigation. If WebGL is unavailable, renderer errors, device is mobile/low-power, data is too large, or reduced motion is preferred, use 2D fallback.
- Limit node count/visual complexity; aggregate large inventories and disclose aggregation. 3D objects are keyboard-accessible through a synchronized entity list and have text labels/status, not color-only meaning.
- Do not animate a “discovery scan” unless actual worker progress supports it. Visual motion can reflect queue/run states only when sourced from backend events.

## 9. UI-to-API contract checklist

| UI capability | Required backend source/action |
|---|---|
| Project creation/validation | `POST /api/v1/projects` with server-side URL/SSRF validation |
| Run discovery/progress/results | `POST .../discovery-runs`, `GET /api/v1/discovery-runs/{id}`, history and changes routes |
| Endpoint inventory/detail | Project endpoint list and endpoint detail routes |
| Check Now/configure | `POST /endpoints/{id}/checks`, `PATCH /endpoints/{id}/monitoring` |
| Dashboard KPIs/charts | Dashboard and analytics routes backed by PostgreSQL results |
| Incident lifecycle | Incident list/detail/transition route with server validation |
| Alerts/acknowledgement | Alert list/detail/update routes; no external delivery implied |
| History/diff | Discovery run and immutable snapshot comparison routes |
| System health | `/api/v1/system/health` backed by measured dependencies/heartbeats |
| Settings | `/api/v1/settings` read-only or explicit validated writes only |

If a route/capability is unavailable, disable or omit the action and explain why; do not substitute local simulation. No frontend route or component for authentication is permitted.
