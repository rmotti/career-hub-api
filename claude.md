# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # dev server with hot reload (tsx watch + .env.local)
npm run build        # compile TypeScript to dist/
npm start            # production (node dist/server.js)
npm test             # run tests with Vitest
npm run db:migrate   # create and apply migration (dev only)
npm run db:generate  # regenerate Prisma Client after schema changes
npm run db:seed      # seed clubs/base data
npm run db:seed-competitions  # seed competitions table
npm run db:studio    # Prisma Studio
```

Run a single test file:
```bash
npx vitest run src/features/clubs/__tests__/clubs.service.test.ts
```

Local dev requires `.env.local` (copy from `.env.example`). Docker Compose provides Postgres + Redis:
```bash
docker compose up -d db redis
```

## Architecture

Feature-based structure: each domain lives in `src/features/<name>/` with three files — `routes.ts` (Fastify schema + handler wiring), `controller.ts` (request/response extraction), `service.ts` (business logic + Prisma queries).

**Request flow:** `app.ts` → route plugin → `preHandler: requireAuth()` → controller → service → Prisma/Redis.

**Auth** (`src/shared/lib/auth.ts`): Better Auth with bearer token. `requireAuth()` in `src/shared/utils/auth-hooks.ts` resolves the session via `auth.api.getSession()` and caches it in Redis for 5 minutes under key `session:<token>`. All protected routes are registered inside a single scoped plugin in `app.ts` that adds this hook once.

**Cache** (`src/shared/utils/cache.ts`): Redis via ioredis. Pattern: `cacheGet` → query → `cacheSet`. Silent failure — cache errors never break the main flow. Use `cacheInvalidate` for point invalidation and `cacheInvalidatePattern` (SCAN-based) sparingly. TTLs are defined per-service as a `TTL` const object.

**Prisma** (`src/shared/lib/prisma.ts`): singleton with `connection_limit=10&pool_timeout=20` appended to `DATABASE_URL`. The `DIRECT_URL` env var (wired via the schema's `directUrl`) is the direct Neon connection used only for migrations (bypasses PgBouncer).

**Stateless-process invariant (required for horizontal scaling):** no request-affecting mutable state may live in process memory — **all** shared state belongs in Redis or Postgres. This is what makes scaling `numReplicas` past 1 safe; `railway.json` runs a single replica today, but the code must stay multi-replica-safe so adding replicas needs no code change. Concretely: caches go through `shared/utils/cache.ts` (Redis), and rate-limit counters through `shared/utils/rate-limit.ts` (Redis fixed-window) — never a module-level `Map`/object/counter. The only permitted in-process data is **immutable, deploy-time-constant** values that are identical in every replica: the hardcoded club list and `LEAGUE_TO_COUNTRY` map in `clubs.service.ts`, the generated club aliases, and config read from env at boot. The one sanctioned exception to "no mutable counters" is **write-only observability** — the fit-score health counters (`fit-score-client.ts`) and the Prometheus metrics registry (`shared/lib/metrics.ts`): these are per-replica by design (the scraper aggregates across instances), are never read back to drive request handling, and reset on restart, so they don't constitute shared state. If you reach for a `let`/mutable singleton that varies per request or accumulates state read back into the request path, that's the regression this invariant exists to catch — put it in Redis instead.

## Domain model

`Save` = one FC 26 career. `ClubStint` = a spell at one club within a save (`isCurrent: true` = active club). `Player` has `activeClubStintId` pointing to the current stint (null = released/loaned out). `PlayerSeasonStats` and `TeamSeasonStats` are created per season when `PATCH /saves/:id` advances `currentSeason`.

Clubs are **in-memory** in `clubs.service.ts` (no DB table). Competitions are in the DB but cached 24h in Redis.

`salary` is stored in thousands of € (75 = €75K). `marketValue` and `budget`/`balance` are in millions of € (100 = €100M). Formatting helpers are in `src/shared/utils/currency.ts`.

## Key conventions

- Fastify route schemas define request validation (body, params, querystring) inline in `routes.ts`. Response schemas are not yet defined — adding them enables fast-json-stringify serialization.
- `AppError(message, statusCode)` for expected errors; `NotFoundError` is a subclass. The global error handler in `app.ts` also catches `PrismaClientKnownRequestError` codes P2025, P2003, P2002.
- **DB degradation contract** (`shared/lib/db-retry.ts`): transient infra errors (DB unreachable, dropped connection, pool timeout, engine panic) surface as a typed **503 `SERVICE_UNAVAILABLE` + `Retry-After`**, never a raw 500. There is **no write queue** — clients retry on 503 (make idempotent writes safe to retry). The Prisma client auto-retries only on pool-timeout (`P2024`), which is provably pre-execution so it can't double-apply a write or corrupt an interactive transaction; ambiguous mid-flight drops are not auto-retried.
- `DISABLE_RATE_LIMIT=true` env var disables Better Auth's rate limiter — set this on Railway when running load tests, never in production traffic.
- **Review checklist — no per-process state:** before approving a change, reject any new mutable in-process state (module-level `Map`/`Set`/array/object/counter, mutable singleton, in-memory cache or rate-limit counter). It would silently break under multiple replicas. Route it through Redis (`cache.ts` / `rate-limit.ts`) instead. See the stateless-process invariant under [Architecture](#architecture).

## Load testing

Seed 200 test users before running:
```bash
npx tsx load-test/seed-users.ts --base-url https://ample-love-production.up.railway.app
```

Run k6 test:
```bash
k6 run --out influxdb=http://localhost:8086/k6 -e BASE_URL=https://ample-love-production.up.railway.app -e VUS=200 -e DURATION=60s load-test/k6.js
```

Grafana dashboard at `http://localhost:3000`. Start InfluxDB + Grafana with `docker compose up -d influxdb grafana`.

## Deployment

Production runs on **Railway** (`railway.json`). Pre-deploy command runs `npx prisma migrate deploy`. Database is **Neon** (PostgreSQL serverless). Redis is a Railway service.

The repo also has a `vercel.json` for Vercel compatibility, but production is Railway.
