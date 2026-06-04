# AI_RULES.md — FC Career Hub API

Operating rules for AI agents working in **this** repository (the backend). Read before making any change.

## What this project is

**fc26-career-hub-api** is the HTTP API behind FC Career Hub — a companion app for EA Sports FC 26 Career Mode. It persists careers ("saves"), squads, transfers, season stats and trophies; serves a read-only FC26 player dataset for scouting; computes a configurable scout score; and exposes an MCP server that powers an AI assistant ("Junior").

It is single-tenant per user: every domain row ultimately hangs off a `Save`, and every `Save` belongs to one `User`. There is no shared/collaborative state.

The frontend (React SPA) lives in a separate repo and is the only first-party consumer.

---

## Tech Stack

- **Node 20 + TypeScript** (ESM, `"type": "module"` — note the `.js` import specifiers on local files).
- **Fastify 4** + `@fastify/cors`, `@fastify/compress`, `@fastify/swagger`, `@fastify/swagger-ui`.
- **Prisma 5 + PostgreSQL** (Neon in prod; pooled via PgBouncer, `DIRECT_URL` for migrations).
- **Redis (ioredis)** — session cache (5 min) and per-service TTL caches. Silent-failure pattern.
- **Better Auth 1.x** — email/password, bearer token, `admin` + `bearer` plugins.
- **OpenAI SDK** (`openai`) — Responses API for the chat assistant (`gpt-4o-mini`).
- **@modelcontextprotocol/sdk** — MCP server mounted at `/mcp`.
- **Vitest** — unit tests.
- Deployed on **Railway**; `vercel.json` exists for legacy Vercel compatibility but prod is Railway.

---

## Architecture (feature-based)

```
src/
├── app.ts            # Fastify instance: plugins, swagger, route registration, error handler
├── server.ts         # listen() / Vercel handler
├── features/<name>/  # one folder per domain capability
│   ├── <name>.routes.ts       # Fastify schema (body/params/querystring) + handler wiring
│   ├── <name>.controller.ts   # request/response extraction only
│   └── <name>.service.ts      # business logic + Prisma + cache
├── mcp/              # MCP server: plugin, auth, tools/, resources/
├── shared/
│   ├── lib/          # prisma, redis, auth, fit-score-client
│   └── utils/        # cache, errors, currency, auth-hooks, origins, fit-score-maps
└── types/            # fastify request augmentation (user, session)
```

### Request flow
`app.ts` → route plugin → `preHandler: requireAuth()` (for protected scope) → controller → service → Prisma/Redis.

All protected routes are registered inside **one** scoped plugin in `app.ts` that adds `requireAuth()` once. Auth routes and the MCP plugin are registered **outside** that scope (they resolve auth themselves).

### The three-file rule
- `routes.ts` — **only** schema + wiring. No business logic.
- `controller.ts` — **only** pulls `params`/`query`/`body`/`request.user` and calls the service. No Prisma.
- `service.ts` — **all** business logic, Prisma queries, cache reads/writes, validation beyond JSON-schema.

---

## Critical Rules

### 1. Routing & registration
- Add routes inside the feature's `routes.ts`; register the plugin in `app.ts` under the protected scope (with `{ prefix: '/api' }`) unless it is genuinely public.
- Define request validation inline in the Fastify `schema` (body/params/querystring). Response schemas are mostly absent today — adding them enables `fast-json-stringify` serialization (and is encouraged for new work).
- Public routes today: `/api/auth/*` and `POST /mcp`. **Everything else must sit under the `requireAuth()` scope.**

### 2. Authorization — verify save ownership in the service
- `requireAuth()` proves the caller is *some* authenticated user. It does **not** prove they own the `saveId` in the URL — that is the service's responsibility.
- For any save-scoped operation, confirm ownership in the service: `prisma.save.findFirst({ where: { id: saveId, userId } })` (the `assertSaveAccess` pattern in `scout-playbooks`/`shortlist`/`saved-searches`, or `scouting`'s `getActiveStint`). Return 404 (not 403) for a non-owned save to avoid leaking existence.
- New save-scoped code passes `request.user.id` into the service and scopes every save lookup by it.

### 3. Plan & role gating
- `requirePlan()` / `requireRole()` live in `shared/utils/auth-hooks.ts` (with `PLAN_HIERARCHY` and an admin bypass).
- To gate a route by plan, add `requirePlan('PRO')` as a `preHandler` — enforce paid features at the API, not only at the client.

### 4. Currency units (match the contract exactly)
- `Player.salary`, wages — **thousands of €** (`75` = €75K).
- `marketValue`, `Save.budget`, `Save.balance`, `Transfer.fee` — **millions of €** (`100` = €100M, `0.9` = €900K).
- Format with `shared/utils/currency.ts` (`formatSalary`, `formatMarketValue`/`formatBalance`). Services return both raw and `*Formatted` fields.

### 5. Caching
- Pattern: `cacheGet(key)` → on miss, query → `cacheSet(key, value, ttl)`. TTLs live in a per-service `TTL` const.
- Cache **must never break the main flow** — `cacheGet`/`cacheSet`/`cacheInvalidate` swallow errors by design.
- On every write, invalidate the matching keys. Use `cacheInvalidate(...keys)` for point invalidation; reserve `cacheInvalidatePattern('save:<id>:*')` (SCAN-based) for cascades like season advance and save delete.
- Key convention: `save:<saveId>:<resource>[:<qualifier>]`, `user:<userId>:saves`, `session:<token>`, `fc26:list:<json>`, `competitions:*`.

### 6. Errors
- Throw `AppError(message, statusCode, code?)` for expected failures; `NotFoundError` is the 404 subclass.
- The global handler in `app.ts` also maps Prisma `P2025`→404, `P2003`→400, `P2002`→409, and `error.validation`→400.
- When the client needs to branch on a specific failure, set `AppError.code` (e.g., `SHIRT_NUMBER_CONFLICT`). The handler then returns `{ error: code, message, statusCode }` instead of `{ error: message, statusCode }`.

### 7. Transactions
- Multi-row mutations that must be atomic use `prisma.$transaction(async (tx) => …)`: save creation (+stint +team stats), season advance cascade, club change, transfer (balance + player + stats).
- Never split an invariant across two awaited queries outside a transaction.

### 8. Language
- **Code** (identifiers, types, filenames): English.
- **API error messages & Swagger descriptions**: Portuguese (PT-BR) — existing surface is PT-BR; keep new strings PT-BR for consistency.
- **Docs in `docs/`**: English.

### 9. Prisma
- Use the singleton from `shared/lib/prisma.ts`. Never instantiate `PrismaClient` elsewhere.
- Schema changes → `npm run db:migrate` (dev) → commit the migration → `npm run db:generate`. Prod applies migrations via Railway's `preDeployCommand` (`prisma migrate deploy`).

### 10. The FC26 dataset is read-only
- `Fc26Player` rows are seeded (`scripts/seed-fc26.ts`); the API never mutates them. Users attach them via `ShortlistItem`.

---

## Quick-Decision Table

| Need | Do |
|---|---|
| New endpoint | Add to the feature's `routes.ts`, controller, service; register under the `requireAuth()` scope in `app.ts` |
| New domain capability | New `src/features/<name>/` with `routes`/`controller`/`service` |
| Verify the caller owns the save | `prisma.save.findFirst({ where: { id: saveId, userId } })` in the service |
| Expected error | `throw new AppError(msg, status)` / `new NotFoundError(msg)` |
| Client-branchable error | `throw new AppError(msg, status, 'SOME_CODE')` |
| Cache a read | `cacheGet`→query→`cacheSet`, TTL in the service's `TTL` const |
| Invalidate on write | `cacheInvalidate('save:<id>:<res>', …)` |
| Money in millions | `formatMarketValue` / `formatBalance` |
| Money in thousands (salary) | `formatSalary` |
| Atomic multi-write | `prisma.$transaction` |
| New MCP capability | Add a tool in `src/mcp/tools/` and register it in `tools/index.ts` |

---

## Anti-patterns (do not introduce)

- A save-scoped service that looks up the save without scoping by `userId` — always confirm ownership (`{ id: saveId, userId }`).
- Business logic or Prisma calls in `routes.ts` or `controller.ts`.
- `new PrismaClient()` or `new Redis()` outside the `shared/lib` singletons.
- Letting a cache error bubble up — cache is best-effort.
- Hardcoding currency formatting instead of using the helpers.
- Adding a write tool to the MCP server without an explicit ownership/authorization story (today all MCP tools are read-only).
- Forwarding secrets or other users' tokens into logs.

---

## Checklist before considering a change done

- [ ] Route registered under the correct scope (`requireAuth()` unless truly public).
- [ ] Service verifies `userId` ownership for save-scoped operations.
- [ ] Cache keys invalidated on every write path.
- [ ] Currency units correct (K for salary, M for the rest).
- [ ] Errors use `AppError`/`NotFoundError`; client-branchable ones carry a `code`.
- [ ] Atomic invariants wrapped in `prisma.$transaction`.
- [ ] Swagger `schema` updated (body/params/querystring); PT-BR descriptions.
- [ ] Migration committed if the schema changed.
- [ ] `npm test` passes; `npm run build` (tsc) is clean.

---

## Auto-audit

- Stack cross-checked against [`package.json`](../../package.json).
- Feature layout and the three-file split confirmed by inspecting `src/features/*`.
- The single `requireAuth()` protected scope confirmed in [`src/app.ts`](../../src/app.ts).
- `requirePlan`/`requireRole` and the `assertSaveAccess` ownership pattern confirmed in `shared/utils/auth-hooks.ts` and the scout services.

_Last verified against commit `d52d3a7`._
