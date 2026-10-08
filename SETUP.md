# Self-Healing API & Intelligent Cache System: Complete Setup Guide

This document is the definitive, executable setup, testing, and troubleshooting runbook for the Self-Healing API & Intelligent Cache System.

---

## 1. Project Prerequisites

Before starting, ensure the following are installed and accessible in your system `PATH`:

- **Python**: `>=3.12` (Required by the backend)
- **Node.js**: `>=18.x` (Required by the Vite frontend)
- **npm**: (Installed with Node.js)
- **uv**: Python package manager
- **Redis**: Local server or Docker container for caching

### Verification Commands (PowerShell)

```powershell
python --version
node --version
npm --version
uv --version
redis-cli ping
```

*(Expected Redis output: `PONG`)*

---

## 2. Project Structure

```text
Self-Healing-API-Intelligent-Cache-System/
│
├── backend/                  # FastAPI Application
│   ├── alembic.ini           # DB migration config
│   ├── app/                  # Main source code
│   ├── migrations/           # Alembic migration scripts
│   ├── pyproject.toml        # Dependencies & tooling configuration
│   ├── tests/                # Pytest suites
│   └── .env                  # Environment variables
│
├── frontend/                 # React + Vite Application
│   ├── package.json          # Node dependencies
│   ├── src/                  # React source code
│   └── vite.config.ts        # Vite/Tailwind configuration
│
└── SETUP.md                  # This setup runbook
```

---

## 3. Environment Configuration

Navigate to the `backend` directory and ensure a `.env` file exists.

### `.env` Reference Table

| Variable | Required | Purpose | Example | Sensitive |
| -------- | -------- | ------- | ------- | --------- |
| `APP_ENV` | Yes | Controls environment behaviors | `development` | No |
| `DEBUG` | No | Enables debug mode | `true` | No |
| `SECRET_KEY` | Yes | JWT signing secret | `change-me...` | **Yes** |
| `DATABASE_URL` | Yes | SQLAlchemy connection string | `sqlite+aiosqlite:///./db.sqlite3` | **Yes** |
| `REDIS_URL` | Yes | Redis connection string | `redis://localhost:6379/0` | **Yes** |
| `FIRST_ADMIN_EMAIL` | Yes | Seeds initial admin account | `admin@example.com` | No |
| `FIRST_ADMIN_PASSWORD`| Yes | Initial admin password | `Admin1234!` | **Yes** |
| `DEVELOPMENT_MODE` | No | Enables `/dev/inject` endpoints | `true` | No |

### Safe `.env.example`

```ini
APP_ENV=development
SECRET_KEY=generate_a_secure_random_string_here
ACCESS_TOKEN_EXPIRE_MINUTES=60
ALGORITHM=HS256
DATABASE_URL=sqlite+aiosqlite:///./db.sqlite3
REDIS_URL=redis://localhost:6379/0
MONITOR_POLL_INTERVAL_SECONDS=10
LOG_LEVEL=INFO
LOG_FORMAT=console
CORS_ALLOWED_ORIGINS='["http://localhost:5173"]'
DEVELOPMENT_MODE=true
FIRST_ADMIN_EMAIL=admin@example.com
FIRST_ADMIN_PASSWORD=Admin1234!
```

---

## 4. Backend Installation

Open PowerShell and follow these exact steps:

### Navigate to backend
```powershell
cd E:\github\Self-Healing-API-Intelligent-Cache-System\backend
```

### Create virtual environment
```powershell
uv venv
```

### Activate virtual environment
```powershell
.venv\Scripts\Activate.ps1
```

### Synchronize dependencies
```powershell
uv sync
```

### Verify Installation
```powershell
uv run python -c "import fastapi; print(fastapi.__version__)"
```

---

## 5. Database Setup

The project uses `sqlite+aiosqlite` by default for development. Production utilizes `postgresql+asyncpg` (e.g., Supabase). 

### Setup Instructions
1. Ensure your `DATABASE_URL` is set in `.env`.
2. Apply database migrations to create all required tables:

```powershell
uv run alembic upgrade head
```

### Verification
If using SQLite, verify that `db.sqlite3` was created in the `backend/` folder.
If migrations fail, verify that you are in the `backend` directory and that `aiosqlite` or `asyncpg` is installed via `uv sync`.

---

## 6. Redis Setup

Redis is required for the intelligent cache fallback.

1. **Local**: Start your local Redis server. 
2. **Hosted**: Update `REDIS_URL` and `REDIS_PASSWORD` in `.env`.

### Verification
```powershell
redis-cli ping
```
*(If Redis is unavailable, the backend readiness probe will degrade, but liveness will remain up).*

---

## 7. Backend Startup

Ensure your virtual environment is active, then run:

```powershell
uv run uvicorn app.main:app --reload
```

- **What it does**: Starts the FastAPI ASGI server on port 8000.
- **`--reload`**: Automatically restarts the server when Python files are modified (Development only).
- **Stop Server**: Press `Ctrl + C`.

### Expected Output
You **must** see the following in the logs for a successful startup:
```text
[INFO] application_starting
[INFO] scheduler_started
[INFO] application_started
[INFO] Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
```

---

## 8. Backend Startup Verification

If you see `Application startup failed.`, the backend is **NOT** working.

**Checklist:**
- [ ] Uvicorn starts without traceback.
- [ ] `scheduler_started` appears (APScheduler).
- [ ] No DB connection errors.
- [ ] No Redis connection errors.

---

## 9. Health Check Testing

The system implements Kubernetes-style probes on port 8000.

### Liveness Probe
```powershell
Invoke-WebRequest http://127.0.0.1:8000/health/live
```
**Expected**: `200 OK` (Indicates the process is running).

### Readiness Probe
```powershell
Invoke-WebRequest http://127.0.0.1:8000/health/ready
```
**Expected**: `200 OK` (Indicates DB & Redis are reachable). Returns `503 Service Unavailable` if degraded.

---

## 10. Swagger UI Verification

Open your browser to: **http://127.0.0.1:8000/docs**

**Verify:**
- [ ] Swagger UI loads.
- [ ] `/api/v1/auth/login` is present.
- [ ] `/api/v1/dev/inject/...` endpoints appear (Requires `DEVELOPMENT_MODE=true`).
- [ ] Click "Authorize" (top right) and login with `admin@example.com` and `Admin1234!` to inject JWT.

---

## 11. ReDoc Verification

Open your browser to: **http://127.0.0.1:8000/redoc**
Alternative layout for API documentation. 
*Note: `/docs` and `/redoc` are disabled automatically when `APP_ENV=production`.*

---

## 12. Authentication Testing

Authentication uses OAuth2 Password Bearer flow.

**Test Sequence (PowerShell):**
```powershell
# 1. Login
$response = Invoke-RestMethod -Method Post -Uri "http://localhost:8000/api/v1/auth/login" -ContentType "application/json" -Body '{"email":"admin@example.com","password":"Admin1234!"}'

# 2. Extract Token
$token = $response.data.access_token

# 3. Test Authenticated Route
Invoke-RestMethod -Method Get -Uri "http://localhost:8000/api/v1/auth/me" -Headers @{Authorization="Bearer $token"}
```
**Expected HTTP Codes:**
- `200 OK` (Valid login / token)
- `401 Unauthorized` (Missing/expired token)
- `422 Unprocessable Content` (Invalid JSON shape)

---

## 13. First Admin Account Testing

During FastAPI lifespan startup, `AuthService.seed_first_admin()` is executed automatically.
- Requires: `FIRST_ADMIN_EMAIL` and `FIRST_ADMIN_PASSWORD` in `.env`.
- Executes **only** if the users table is completely empty.
- If it fails, the application does not crash, but logs `first_admin_seed_failed`.

---

## 14. Endpoint Registration Testing

To test external API monitoring registration:
1. Log into Swagger UI.
2. Expand `POST /api/v1/endpoints`.
3. Provide payload: `{"name": "Test API", "url": "https://api.example.com"}`.
4. Execute and verify `201 Created`.
5. Expand `GET /api/v1/endpoints` and verify the new API appears.

---

## 15. Monitoring Worker Testing

The background worker utilizes **APScheduler**.
- It runs inside the Uvicorn process.
- Polls external APIs every `MONITOR_POLL_INTERVAL_SECONDS`.
- Logs timeouts and creates database Incidents automatically if endpoints fail.

**Verification**:
Look at the backend terminal output. You should periodically see logs related to endpoint health checks executing.

---

## 16. Failure Injection Testing

Failure injection safely simulates outages in development. They require `ADMIN` authentication.

### Test A — Database Failure
- **Route**: `POST /api/v1/dev/inject/database-failure`
- **Behavior**: Throws a `DatabaseTimeoutError`. 
- **Expected Status**: `500` or `503` (Mapped dynamically by error handler).

### Test B — Redis Timeout
- **Route**: `POST /api/v1/dev/inject/redis-timeout`
- **Behavior**: Sleeps asynchronously, returns simulated error.
- **Expected Status**: `200 OK` with JSON `{"status": "error"}` payload.

### Test C — Latency Injection
- **Route**: `POST /api/v1/dev/inject/latency?delay_ms=3000`
- **Behavior**: Sleeps for 3 seconds. Used to test frontend timeouts.

> [!WARNING]
> These routes are isolated to `dev.py` and must NEVER be enabled in production.

---

## 17. Intelligent Cache Testing

The system implements a Cache-Aside + Stale Fallback pattern.

### Test 1 — Cache MISS
Request `GET /api/v1/cache/resource/profile`.
- **Result**: Data is fetched from source, cached in Redis, and returned.

### Test 2 — Cache HIT
Repeat `GET /api/v1/cache/resource/profile`.
- **Result**: Response is near-instant. Served directly from Redis.

### Test 3 — Upstream Failure (Stale Fallback)
Simulate source failure.
- **Result**: Cache Manager detects failure and returns the stale fallback payload from Redis. User receives degraded but functional data instead of a 500 error.

### Test 4 — No Cached Response
Request unknown resource `GET /api/v1/cache/resource/unknown`.
- **Result**: Falls back to `no_data` response safely.

---

## 18. Incident Management Testing

1. **Failure**: Worker detects target API timeout.
2. **Incident Created**: Database creates record with `ACTIVE` status.
3. **Endpoint Unhealthy**: Frontend marks endpoint as `DOWN`.
4. **Recovery**: Target API responds successfully.
5. **Incident Resolved**: Status transitions to `RESOLVED` with recovery timestamp.

---

## 19. Database Failure Testing

**Simulation**: Stop PostgreSQL/SQLite temporarily.
- **Behavior**: `/health/ready` probe transitions to `degraded` (503).
- **Resilience**: Liveness probe remains 200. Fallback cache requests (Redis only) may still function if properly isolated.

---

## 20. Redis Failure Testing

**Simulation**: Stop `redis-server`.
- **Behavior**: `/health/ready` probe degrades. Cache operations fallback seamlessly to origin database without crashing the application.

---

## 21. Error Handling Verification

All errors flow through `_register_exception_handlers` in `main.py`.

- **422 Validation Error**: Thrown natively by Pydantic.
- **500 Unexpected Error**: Caught at the outermost boundary. Internal tracebacks are logged using `structlog`, but **NEVER** exposed to the HTTP response.

**Expected JSON Response:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation error on 'body -> email': value is not a valid email address",
    "request_id": "req_123456"
  }
}
```

---

## 22. Request ID Verification

Every incoming request passes through `RequestIDMiddleware` which generates a unique UUID (e.g., `req_abc123`).
- Injected into **HTTP Headers**: `X-Request-ID`.
- Injected into **Logs**: Appears in all structured JSON logs.
- Injected into **Errors**: Correlates frontend errors to backend logs.

---

## 23. Structured Logging Verification

Managed by `structlog`.
- **Development** (`LOG_FORMAT=console`): Outputs colorful, human-readable terminal logs.
- **Production** (`LOG_FORMAT=json`): Outputs pure JSON lines containing `request_id`, `environment`, `logger`, and stack traces for Datadog/ELK ingestion.

---

## 24. Frontend Setup

Open a new PowerShell window:

```powershell
cd E:\github\Self-Healing-API-Intelligent-Cache-System\frontend
npm install
npm run dev
```

**Expected Output:**
```text
  VITE v8.2.2  ready in 500 ms
  ➜  Local:   http://localhost:5173/
```

---

## 25. Frontend Environment Variables

The frontend is currently configured via hardcoded base URLs in `src/lib/api.ts` pointing to `http://localhost:8000`. 
No `.env` file is strictly required for local development.

---

## 26. Frontend ↔ Backend Integration Testing (UI Test Plan)

To ensure the frontend React app is properly communicating with the FastAPI backend, you can perform the following 8 tests directly in your browser. These tests will verify inputs, expected outputs, and end-to-end functionality.

### Test 1: Authentication & Token Issuance
- **Input**: Open `http://localhost:5173`. You will be redirected to the Login page. Enter Email: `admin@example.com` and Password: `Admin1234!`. Click Login.
- **Expected Output**: You are instantly redirected to the Dashboard (`/`). The network tab will show a `200 OK` from `/auth/login`, and a JWT token is saved in localStorage. 

### Test 2: Dashboard Global Health Sync
- **Input**: Navigate to the Dashboard. No action required.
- **Expected Output**: The **Global Health** metric should display **99.9%** (green). This confirms the frontend is successfully polling the backend `/ready` Kubernetes probe and displaying system status.

### Test 3: Create Monitored Endpoint
- **Input**: Go to the **Endpoints** page. Click "Add Endpoint". Enter Name: `Test API` and URL: `https://httpstat.us/200`. Click "Add Endpoint".
- **Expected Output**: The modal closes, and `Test API` appears in the table. This verifies the frontend's `POST /endpoints` request is properly validating and saving to the backend database.

### Test 4: Background Worker Status Update
- **Input**: Stay on the **Endpoints** page and wait for 10-15 seconds (the backend polling interval).
- **Expected Output**: The status badge on `Test API` should update to **HEALTHY**. This confirms the backend's APScheduler background worker is actively pinging the URL, saving the result, and the frontend is fetching the fresh data.

### Test 5: Delete Monitored Endpoint
- **Input**: Click the red Trash icon on the `Test API` row in the Endpoints page.
- **Expected Output**: The row vanishes from the table immediately. This verifies the `DELETE /endpoints/{id}` backend route and React Query cache invalidation.

### Test 6: View Cache Policies
- **Input**: Navigate to the **Cache** page.
- **Expected Output**: A list of backend-configured cache policies (e.g., `endpoints`, `profile`) is displayed in the "Cache Policies" card, showing their TTLs and fallback configurations. This confirms `GET /cache/policies` integration.

### Test 7: Manual Cache Invalidation
- **Input**: On the **Cache** page, under "Manual Invalidation", type `endpoints` into the input field and click "Invalidate Cache".
- **Expected Output**: A browser alert pops up stating `"Invalidated cache for: endpoints"`. This confirms the frontend is successfully commanding the backend to clear specific Redis keys via `DELETE /cache/resource/{res}`.

### Test 8: End-to-End Incident Tracking
- **Input**: Add a new Endpoint with a broken URL (Name: `Broken API`, URL: `https://httpstat.us/500`). Wait for 15 seconds, then return to the **Dashboard**.
- **Expected Output**: **Active Incidents** increases by 1. The **Recent Activity** list shows an "Ongoing Incident" for "Broken API". **Global Health** may show as "Degraded". This verifies the entire system: background worker failure detection, incident creation in DB, and frontend real-time syncing.

---

## 27. Complete End-to-End Test

1. Start SQLite/PostgreSQL & Redis.
2. Start backend (`uv run uvicorn app.main:app`).
3. Start frontend (`npm run dev`).
4. Login to dashboard.
5. Create a monitored endpoint.
6. Verify global health shows `ready`.
7. Refresh cache policies page to confirm Cache APIs return 200.
8. Stop Redis.
9. Verify Dashboard Global Health transitions to `Degraded`.

---

## 28. Observability Verification

OpenTelemetry and Prometheus instrumentations are configured in `pyproject.toml`.
- Metrics are tracked for Cache Hits, Misses, and Failures natively in the backend service logic.

---

## 29. Automated Tests

Run the complete test suite using `pytest`:

```powershell
uv run pytest
```
- **Coverage**: `uv run pytest --cov=app`
- Tests use `aiosqlite` memory databases and isolate Redis dependencies.

---

## 30. Production Readiness Checks

### Security
- [ ] `SECRET_KEY` is a 256-bit secure random string.
- [ ] `APP_ENV=production` is set (Disables Swagger UI).
- [ ] CORS is restricted to production domains.
- [ ] `DEVELOPMENT_MODE=false`.

### Reliability
- [ ] Redis is highly available.
- [ ] Database connection pooling configured via AsyncPG.

### Observability
- [ ] `LOG_FORMAT=json`.

---

## 31. Troubleshooting

| Error | Cause | Solution |
| ----- | ----- | -------- |
| `ModuleNotFoundError: No module named 'aiosqlite'` | Dependencies not synced | Run `uv sync` in the backend directory. |
| `Settings object has no attribute 'is_testing'` | Missing config flag | Ensure `.env` is loaded, or `is_testing` exists in `config.py`. |
| `server restart failed` (Vite) | Package installed while Vite was running | Press `Ctrl+C` in frontend terminal and restart `npm run dev`. |
| `UI unstyled / missing CSS` | Tailwind not compiling | Ensure `tailwindcss` and `@tailwindcss/vite` are installed via `npm install`. |
| `422 Unprocessable Content` on Login | Form Data instead of JSON | Ensure frontend `apiFetch` uses `JSON.stringify({email, password})`. |
| `ConnectionRefusedError: [WinError 10061]` | Redis is down | Start `redis-server` locally. |

---

## 32. Windows-Specific Troubleshooting

- **Virtual Environment Execution Policy**: If PowerShell blocks `.venv\Scripts\Activate.ps1`, run: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`.
- **Port 8000 Conflict**: If uvicorn crashes due to port in use, find the process `netstat -ano | findstr :8000` and kill it `taskkill /PID <id> /F`.
- **File Locks**: If `npm install` fails due to locked files, close Vite/IDE and retry.

---

## 33. Final "Is My Project Working?" Checklist

### Infrastructure
- [ ] Database reachable
- [ ] Redis reachable

### Backend
- [ ] `uv sync` complete
- [ ] `uv run uvicorn` starts cleanly without tracebacks
- [ ] `/health/ready` returns 200 OK
- [ ] Swagger UI loads
- [ ] APScheduler logs indicate worker polling
- [ ] JWT Login succeeds via Swagger

### Frontend
- [ ] `npm install` & `npm run build` complete without type errors
- [ ] Vite dev server loads
- [ ] UI is fully styled (Tailwind renders)
- [ ] Dashboard successfully fetches backend API data

---

## 34. Project Status Classification

### 🟢 FULLY WORKING
If you have completed this guide and checked all boxes in Section 33, your Self-Healing API System is officially fully working end-to-end!
