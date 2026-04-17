# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

### Backend (run from `backend/`)
```bash
poetry run python -m uteki.main_dev        # Dev server (port 8888, includes Admin API)
poetry run python -m uteki.main             # Production server (port 8888, limited routes)
poetry run pytest                           # All tests with coverage
poetry run pytest tests/unit/test_foo.py    # Single test file
poetry run pytest -k "test_name"            # Single test by name
poetry run ruff check .                     # Lint
poetry run ruff check . --fix               # Lint + autofix
poetry run ruff format .                    # Format
poetry run mypy .                           # Type check (strict mode)
alembic revision --autogenerate -m "msg"    # Create migration
alembic upgrade head                        # Apply migrations
```

### Frontend (run from `frontend/`)
```bash
pnpm dev          # Dev server (port 5173, proxies /api → localhost:8888)
pnpm build        # Production build
pnpm lint         # ESLint
pnpm format       # Prettier
```

### Infrastructure
```bash
./scripts/start-full.sh     # Start all Docker services (PG, Redis, ClickHouse, Qdrant, MinIO)
docker-compose up           # Same, manual
./scripts/verify_system.sh  # Health check all services
```

Docker services: PostgreSQL 17+TimescaleDB (:5432), ClickHouse (:8123/:9000), Redis 7 (:6379), Qdrant v1.11 (:6333), MinIO (:9000/:9001). All on `uteki-network`.

## Architecture

**Monorepo**: `backend/` (FastAPI/Python), `frontend/` (React/TS/Vite), `mobile/` (Flutter)

### Backend Domain Structure

Each domain in `backend/uteki/domains/` follows a standard layout:
- `api.py` — FastAPI router, mounted at `/api/{domain}/...`
- `models.py` — SQLAlchemy ORM models
- `schemas.py` — Pydantic request/response schemas
- `service.py` — Business logic
- `repository.py` — Data access layer

**12 domains**: admin, agent, auth, company, data, evaluation, index, macro, news, notification, snb, user

Larger domains (index, macro, news, snb) split models/services into subdirectories.

### Key Subsystems

**LLM Adapter** (`domains/agent/llm_adapter.py`): Unified interface across OpenAI, Claude, DeepSeek, Qwen, Gemini. `LLMAdapterFactory.create()` → `adapter.chat()` returns `AsyncGenerator[str, None]`. Even with `stream=False`, consume via `async for chunk`.

**Agent Core** (`domains/agent/core/`): Budget management, execution context, tool parsing (text-based, not native API tool calls).

**Index Domain** (`domains/index/`): Arena-style evaluation — 3-phase pipeline (Decide → Vote → Tally). Each model gets independent DB session via `db_manager.get_postgres_session()` for concurrent writes.

**Database Manager** (`common/database.py`): Global `db_manager` singleton with tiered degradation:
- Tier 1 (Critical): PostgreSQL + Redis
- Tier 2 (Fallback to PG): ClickHouse
- Tier 3 (Optional): Qdrant, MinIO

Sessions: `async with db_manager.get_postgres_session() as session:` — auto-commits on success.

**Schema Namespacing**: DB schemas per domain (e.g., `index` schema). Models use `get_table_args(schema="index")` and FK refs use `get_table_ref("table", schema="index")` from `common/base.py`. SQLite ignores schemas; PostgreSQL uses them.

**Model Mixins** (`common/base.py`): `Base`, `UUIDMixin`, `TimestampMixin`.

**Singleton Services**: Pattern is `_service: Optional[T] = None` + `get_service()` function.

**Cache Service** (`common/cache.py`): Redis primary + in-memory fallback. Key pattern: `key:domain:operation:params`. Global `get_cache_service()` singleton. Supports `get_or_set()` for cache-aside.

**Schedulers** (`schedulers/`): APScheduler-based background jobs — news collection (CNBC/Bloomberg), index price updates, data collection. Started in `main_dev.py` lifespan event.

**Evaluation Domain** (`domains/evaluation/`): Pipeline consistency testing — runs the Company Agent N times and measures output stability (action agreement, conviction stats, gate score variance). Uses `EvaluationRun` and `EvaluationGateScore` models with JSON storage for runs/metrics.

### Frontend Structure

- `src/pages/` — route-level components (`/admin`, `/agent`, `/dashboard`, etc.)
- `src/components/` — organized by domain (chat, crypto, macro, news, index, company)
- `src/api/` — Axios-based API client functions
- `src/hooks/` — custom React hooks
- Path alias: `@/` → `src/` (configured in vite.config.ts)
- State: Zustand stores + React Query for server state
- UI: MUI 6 + TailwindCSS + Framer Motion
- Charts: ECharts, Recharts, Lightweight Charts

### Auth Flow

Frontend login redirects to backend OAuth endpoint (GitHub/Google/Apple). Backend returns token in URL hash. Frontend extracts token → localStorage → `Authorization: Bearer` header on subsequent requests.

### Dev vs Prod Entry Points

- `main_dev.py`: All routes + Admin API + schedulers. Use for local development.
- `main.py`: Production — health check + limited routes. Agent/Admin APIs disabled (Cloud Run startup timeout).

### CI/CD

GitHub Actions (`.github/workflows/deploy.yml`): push to main → Docker build → Google Artifact Registry → Cloud Run. Backend: 2 CPU, 1GB RAM, max 10 instances. Frontend: 1 CPU, 256MB.

## Local Dev URLs

- **Backend API docs**: http://localhost:8888/docs
- **Backend health check**: http://localhost:8888/health
- **Frontend**: http://localhost:5173
- **MinIO console**: http://localhost:9001 (uteki / uteki_dev_pass)

## Configuration

Backend `.env` file in `backend/` — see `backend/.env.example` or README for template. Database URLs, Redis, MinIO credentials go here. LLM provider API keys and exchange credentials are configured at runtime via the `/admin` page, not in `.env`.

## Important Gotchas

- **Local dev port is 8888** — never use 8000 or other ports
- **Working directory** for Python imports is `backend/`, not project root
- **Frontend has pre-existing TS errors** in news/calendar components — ignore them
- **Google Gemini** needs `base_url` from `settings.google_api_base_url`
- **Root directory docs policy**: Do not create `.md` files in project root without explicit permission (see `.cursorrules`)
- **Commits**: Never commit without user instruction. Use semantic commit messages. Always include `Co-Authored-By:` line

## Tooling Config (in `backend/pyproject.toml`)

- Ruff: line-length=100, target py310, rules E/W/F/I/B/C4/UP, ignores E501/B008
- MyPy: strict mode, ignore_missing_imports=true
- pytest: asyncio_mode=auto (no need for `@pytest.mark.asyncio`), coverage on `uteki` package
