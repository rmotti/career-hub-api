# FC 26 Career Hub — API

![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5+-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-4+-000000?logo=fastify&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-5+-2D3748?logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-336791?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-ioredis-DC382D?logo=redis&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-Model_Context_Protocol-6E56CF)
![CI](https://github.com/rmotti/career-hub-api/actions/workflows/ci.yml/badge.svg)

> API for tracking FC 26 Career Mode. Manage career saves, squads, per-season stats, transfers, trophies and club spells — plus an FC 26 player dataset, a scouting engine with fit scoring, and an AI tactical assistant ("Mister") backed by an embedded MCP server.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Database](#database)
- [API Routes](#api-routes)
- [MCP Server](#mcp-server)
- [AI Coach (Mister)](#ai-coach-mister)
- [Authentication & Plans](#authentication--plans)
- [Environment Variables](#environment-variables)
- [Scripts](#scripts)
- [Folder Structure](#folder-structure)
- [Load Testing](#load-testing)
- [CI/CD](#cicd)
- [Deployment](#deployment)

---

## Prerequisites

- Node.js >= 22
- npm
- PostgreSQL (recommended: [Neon](https://neon.tech))
- Redis (local or managed)
- _(optional)_ An OpenAI API key — only required for the AI coach (`/chat`) feature

---

## Installation

```bash
git clone https://github.com/rmotti/career-hub-api
cd career-hub-api
npm install
```

---

## Configuration

```bash
cp .env.example .env.local
```

Fill in the variables described in [Environment Variables](#environment-variables).

For local infrastructure, Docker Compose provides Postgres + Redis:

```bash
docker compose up -d db redis
```

---

## Architecture

Feature-based structure: each domain lives in `src/features/<name>/` and is split into
`*.routes.ts` (Fastify schema + handler wiring), `*.controller.ts` (request/response
extraction) and `*.service.ts` (business logic + Prisma queries).

**Request flow:** `app.ts` → route plugin → `preHandler: requireAuth()` → controller → service → Prisma/Redis.

- **Auth** (`src/shared/lib/auth.ts`): Better Auth with bearer token. `requireAuth()` resolves the
  session via `auth.api.getSession()` and caches it in Redis for 5 minutes under `session:<token>`.
- **Cache** (`src/shared/utils/cache.ts`): Redis via ioredis. `cacheGet` → query → `cacheSet`.
  Cache errors never break the main flow (silent failure).
- **Prisma** (`src/shared/lib/prisma.ts`): singleton with `connection_limit=10&pool_timeout=20`
  appended to `DATABASE_URL`. `DIRECT_URL` is the direct Neon connection used only for migrations.
- **DB degradation contract** (`src/shared/lib/db-retry.ts`): transient infra errors surface as a
  typed **503 `SERVICE_UNAVAILABLE` + `Retry-After`**, never a raw 500. There is no write queue —
  clients retry on 503, so idempotent writes are safe to retry.
- **Stateless-process invariant:** no request-affecting mutable state lives in process memory — all
  shared state belongs in Redis or Postgres, which keeps the service safe to run on multiple replicas.

---

## Database

**ORM**: Prisma · **Database**: PostgreSQL (Neon)

### Migrations

```bash
npm run db:migrate           # create & apply a migration (dev)
npx prisma migrate deploy    # apply migrations in production
```

### Seed

```bash
npm run db:seed               # base seed (clubs, etc.)
npm run db:seed-competitions  # competitions seed
npm run db:seed-fc26          # import the FC 26 player dataset
npm run db:migrate-data       # migrate legacy data
```

### Studio

```bash
npm run db:studio
```

### Models

| Model | Description |
|---|---|
| `User` | Authenticated user (Better Auth), carries a `plan` (`FREE` / `PRO` / `PREMIUM`) |
| `Session` / `Account` / `Verification` | Better Auth session models |
| `Save` | One FC 26 career |
| `SaveSnapshot` | Restore point captured before irreversible operations (or manually) |
| `AuditLog` | Append-only log of irreversible mutations and recoveries on a save |
| `ClubStint` | A spell at one club within a save (`isCurrent: true` = active club) |
| `Player` | Squad player; `activeClubStintId` points to the current stint |
| `PlayerOvrHistory` | Player overall history per season |
| `PlayerSeasonStats` | Player stats per season/club |
| `TeamSeasonStats` | Team stats per competition and season |
| `Transfer` | Incoming or outgoing transfer |
| `Trophy` | Trophy won, linked to a `ClubStint` |
| `Competition` | Competition (league, national cup, european, super cup) |
| `Fc26Player` | Read-only FC 26 player dataset (scouting source) |
| `ScoutPlaybook` | Configurable weights/preferences for scoring transfer targets |
| `ShortlistItem` | A shortlisted player within a save |
| `SavedSearch` | A saved scouting filter within a save |

Clubs are **in-memory** in `clubs.service.ts` (no DB table). Competitions live in the DB but are cached in Redis for 24h.

> **Money units:** `salary` is in thousands of € (`75` = €75K). `marketValue`, `budget` and
> `balance` are in millions of € (`100` = €100M). Helpers live in `src/shared/utils/currency.ts`.

---

## API Routes

Base URL: `http://localhost:3333/api`

Interactive docs (Swagger): `http://localhost:3333/docs`

Legend: 🔓 public · 🔒 requires session · ⭐ requires session **and** `PRO` plan.

### Health — 🔓 Public

| Method | Route | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `GET` | `/health/fit-score` | Health of the coupling with the fit-score service (passive signal; 503 when `down`) |
| `GET` | `/metrics` | Prometheus metrics (requires `Authorization: Bearer <METRICS_TOKEN>` when the token is set) |

### Auth — 🔓 Public

| Method | Route | Description |
|---|---|---|
| `POST` | `/auth/sign-up/email` | Register a new user |
| `POST` | `/auth/sign-in/email` | Sign in with email + password |
| `GET` | `/auth/session` | Check the active session |
| `POST` | `/auth/sign-out` | End the session |
| `GET` | `/auth/csrf` | Fetch a CSRF token |

### Clubs — 🔒

| Method | Route | Description |
|---|---|---|
| `GET` | `/clubs` | List all available clubs |
| `GET` | `/clubs/by-league` | List clubs grouped by league |

### Competitions — 🔒

| Method | Route | Description |
|---|---|---|
| `GET` | `/competitions` | List all competitions |
| `GET` | `/competitions/european` | List european competitions |

### Saves — 🔒

| Method | Route | Description |
|---|---|---|
| `GET` | `/saves` | List the user's saves (with the current club stint) |
| `GET` | `/saves/:saveId` | Get a save by ID |
| `POST` | `/saves` | Create a new save |
| `PATCH` | `/saves/:saveId` | Update a save (advance season, budget, european competition) |
| `DELETE` | `/saves/:saveId` | Delete a save (soft by default & reversible; `?purge=true` for permanent) |
| `GET` | `/saves/deleted` | List archived (soft-deleted) saves — the trash |
| `POST` | `/saves/:saveId/restore` | Restore an archived save |
| `GET` | `/saves/:saveId/audit` | Audit history of irreversible mutations/recoveries |
| `GET` | `/saves/:saveId/snapshots` | List restore points |
| `POST` | `/saves/:saveId/snapshots` | Take a manual snapshot (save-point) |
| `POST` | `/saves/:saveId/snapshots/:snapshotId/restore` | Restore the whole save from a snapshot |

**POST `/saves` — body:**
```json
{
  "name": "My Career",
  "club": "Liverpool",
  "budget": 100,
  "europeanCompetitionId": "optional-uuid"
}
```
> `budget` in millions of €: `100` = €100M. Initial `balance` equals `budget`. Creating a save also
> creates the initial `ClubStint` and `TeamSeasonStats` for every competition in the club's country.

**PATCH `/saves/:saveId` — body:**
```json
{
  "currentYear": 2027,
  "currentSeason": "2027/28",
  "budget": 80,
  "balance": 12,
  "europeanCompetitionId": "uuid-or-null"
}
```
> Changing `currentSeason` automatically creates `TeamSeasonStats` per competition, `PlayerSeasonStats`
> for every active player, and checks trophies for the closed season. Delete and season advances take a
> safety snapshot first, so they can be reverted via the snapshot restore endpoint.

### Club Stints — 🔒

| Method | Route | Description |
|---|---|---|
| `GET` | `/saves/:saveId/club-stints` | List club spells |
| `GET` | `/saves/:saveId/club-stints/current` | Get the current club (`isCurrent: true`) |
| `POST` | `/saves/:saveId/club-stints` | Move clubs (closes the current stint, opens a new one in a transaction) |
| `PATCH` | `/saves/:saveId/club-stints/:stintId` | Update a stint |

**POST — body:**
```json
{
  "club": "Real Madrid",
  "europeanCompetitionId": "optional-uuid"
}
```
> Runs in a transaction: closes the previous stint, detaches all players, and creates
> `TeamSeasonStats` for the new club's competitions.

### Players — 🔒

| Method | Route | Description |
|---|---|---|
| `GET` | `/saves/:saveId/players` | List players (`?active=true` for the active squad, `?season=` for a season) |
| `GET` | `/saves/:saveId/players/:playerId` | Get a player with full history |
| `POST` | `/saves/:saveId/players` | Add a player to the squad |
| `PUT` | `/saves/:saveId/players/:playerId` | Update a player |
| `PATCH` | `/saves/:saveId/players/:playerId/stats` | Update current-season stats |
| `POST` | `/saves/:saveId/players/import-fc26` | Import the squad from the FC 26 dataset by current club |
| `DELETE` | `/saves/:saveId/players/:playerId/release` | Release a player (leaves the squad, stays in the save) |

**POST — body:**
```json
{
  "name": "Vinícius Jr.",
  "position": "PE",
  "age": 26,
  "status": "Crucial",
  "ovr": 91,
  "potential": 95,
  "shirtNumber": 7,
  "nation": "Brazil",
  "alternativePosition": { "positions": ["PD", "SA"] },
  "salary": 75,
  "marketValue": 150
}
```
> `salary` in thousands of € (`75` = €75K), `marketValue` in millions of € (`150` = €150M).
> `alternativePosition.positions` accepts zero or more secondary positions (don't repeat the primary).

**Valid enums:**

| Field | Values |
|---|---|
| `position` / `alternativePosition.positions` | `GOL`, `ZAG`, `MEI`, `ATA`, `LD`, `LE`, `VOL`, `MC`, `ME`, `MD`, `PE`, `PD`, `SA` |
| `status` | `Crucial`, `Important`, `Role`, `Sporadic`, `Promising`, `Loan` |

### Team Stats — 🔒

| Method | Route | Description |
|---|---|---|
| `GET` | `/saves/:saveId/team-stats` | List stats per competition (`?season=current` or `?season=2027/28`) |
| `POST` | `/saves/:saveId/team-stats` | Create a team-stats row for a competition |
| `PATCH` | `/saves/:saveId/team-stats/:statsId` | Update a competition's stats |
| `DELETE` | `/saves/:saveId/team-stats/:statsId` | Delete a team-stats row |

**PATCH — body:**
```json
{
  "goalsPro": 55,
  "goalsAgainst": 22,
  "wins": 24,
  "draws": 5,
  "losses": 9,
  "leaguePosition": 1,
  "cupResult": "Campeao"
}
```

**`CupResult` enum:**

| Value | Meaning |
|---|---|
| `Campeao` | Won the competition |
| `Final` | Runner-up |
| `Semifinal` | Knocked out in the semifinals |
| `Quartas` | Knocked out in the quarterfinals |
| `OitavasOuFaseDeGrupos` | Knocked out in the round of 16 or group stage |
| `Eliminado` | Knocked out at an unspecified stage |
| `NaoParticipou` | Did not participate (default) |

### Transfers — 🔒

| Method | Route | Description |
|---|---|---|
| `GET` | `/saves/:saveId/transfers` | List transfers (`?season=current` for the current season) |
| `POST` | `/saves/:saveId/transfers` | Record a transfer |
| `PUT` | `/saves/:saveId/transfers/:tid` | Update a transfer |
| `DELETE` | `/saves/:saveId/transfers/:tid` | Delete a transfer |
| `POST` | `/saves/:saveId/transfers/:tid/reverse` | Reverse a transfer (refunds the balance + restores the squad) |

**POST — body:**
```json
{
  "playerName": "Kylian Mbappé",
  "type": "compra",
  "from": "Real Madrid",
  "to": "Liverpool",
  "fee": 80,
  "season": "2027/28",
  "playerId": "optional-uuid"
}
```
> `fee` in millions of €. Valid `type` values: `compra` (buy), `venda` (sell),
> `emprestimo_entrada` (loan in), `emprestimo_saida` (loan out).

### Trophies — 🔒

| Method | Route | Description |
|---|---|---|
| `GET` | `/saves/:saveId/trophies` | List trophies with club and competition |
| `POST` | `/saves/:saveId/trophies` | Add a trophy to the current `ClubStint` |
| `DELETE` | `/saves/:saveId/trophies/:id` | Delete a trophy |

**POST — body:**
```json
{ "competitionId": "competition-uuid", "year": 2027 }
```
> Use `GET /api/competitions` to obtain valid competition UUIDs.

### FC 26 Players (dataset) — ⭐ PRO

| Method | Route | Description |
|---|---|---|
| `GET` | `/fc26-players/filters` | Metadata for filter dropdowns (distinct nations/clubs/leagues/traits…), cached 24h |
| `GET` | `/fc26-players` | List dataset players with rich filters; pass `?saveId=` to compute a fit score per player |
| `GET` | `/fc26-players/:sofifaId` | Get a single dataset player by `sofifaId` |

> Supported filters include `positions`, `primaryPositions`, `secondaryPositions`, `nations`, `clubs`,
> `leagues`, `min/maxMarketValue`, `min/maxPace`, `min/maxHeight`, `preferredFoot`, `traits`, `limit`
> (max 100), plus `saveId` + `objective` (e.g. `balanced`, `attack`, `title`) to drive fit scoring.

### Scouting — ⭐ PRO

| Method | Route | Description |
|---|---|---|
| `GET` | `/scouting/saves/:saveId/gaps` | Identify squad gaps for the save's active club |
| `GET` | `/scouting/transfer-targets` | Find transfer targets in the FC 26 dataset |
| `GET` | `/scouting/saves/:saveId/evaluate/:sofifaId` | Evaluate a specific player's fit for the save |

### Scout Playbooks — ⭐ PRO

| Method | Route | Description |
|---|---|---|
| `GET` | `/scout/playbooks` | List scout playbooks (filter by `?saveId=`) |
| `GET` | `/scout/playbooks/:id` | Get a playbook |
| `POST` | `/scout/playbooks` | Create a playbook |
| `PATCH` | `/scout/playbooks/:id` | Update a playbook |
| `DELETE` | `/scout/playbooks/:id` | Delete a playbook |
| `POST` | `/scout/evaluate` | Score dataset players with a playbook (`scoutScore` from configurable weights + historical fit) |

### Shortlist — ⭐ PRO

| Method | Route | Description |
|---|---|---|
| `GET` | `/saves/:saveId/shortlist` | List shortlisted players |
| `POST` | `/saves/:saveId/shortlist` | Add a player to the shortlist |
| `PATCH` | `/saves/:saveId/shortlist/:itemId` | Update a shortlist item (e.g. priority) |
| `DELETE` | `/saves/:saveId/shortlist/:itemId` | Remove a player from the shortlist |

> `priority` enum: `LOW`, `MEDIUM`, `HIGH`.

### Saved Searches — ⭐ PRO

| Method | Route | Description |
|---|---|---|
| `GET` | `/saves/:saveId/saved-searches` | List saved scouting filters |
| `POST` | `/saves/:saveId/saved-searches` | Create a saved search |
| `PATCH` | `/saves/:saveId/saved-searches/:id` | Update a saved search |
| `DELETE` | `/saves/:saveId/saved-searches/:id` | Delete a saved search |

### AI Coach — ⭐ PRO

| Method | Route | Description |
|---|---|---|
| `POST` | `/chat/messages` | Send a message to the tactical assistant ("Mister") |

See [AI Coach (Mister)](#ai-coach-mister).

---

## MCP Server

An embedded **MCP (Model Context Protocol)** server exposes read-only tools and resources over a
user's save data, so any MCP client (or the OpenAI/Anthropic APIs) can reason about the career.

- **Endpoint:** `POST /mcp` — Streamable HTTP transport, stateless per request (note: no `/api` prefix).
- **Auth:** Bearer token (the same Better Auth session token). `401` without a header or with an invalid token.
- **Rate limit:** 60 calls / 60s per user; `429` with `Retry-After` when exceeded.

**Tools (8):** `get_active_save_context`, `list_saves`, `get_finances`, `analyze_squad_by_position`,
`get_season_performance`, `identify_squad_gaps`, `search_transfer_targets`, `evaluate_signing_fit`.

**Resources (2):** `playbook://{saveId}` (default playbook weights) and
`save://{saveId}/dossier` (dense briefing: club, finances, top squad, gaps, current-season results).
Both are cached 5 min in Redis and validate ownership.

Full details and client-integration examples (OpenAI Responses API, Claude Desktop) live in
[`src/mcp/README.md`](src/mcp/README.md).

---

## AI Coach (Mister)

`POST /api/chat/messages` is a `PRO` tactical assistant. It calls the embedded MCP server to read the
user's save data and replies with analysis or recommendations.

**Body:**
```json
{
  "message": "What are my squad's main gaps?",
  "previousResponseId": "optional-openai-response-id"
}
```
> Pass `previousResponseId` (from the OpenAI Responses API) to keep conversation context. The chat is
> per-user rate-limited and powered by `OPENAI_API_KEY` / `OPENAI_CHAT_MODEL` (default `gpt-4o-mini`).

---

## Authentication & Plans

The API uses **Better Auth** with bearer-token sessions. After the first validation, the session is
cached in Redis for 5 minutes.

Include the token on every protected route:

```http
Authorization: Bearer <token>
```

The token is obtained from `POST /api/auth/sign-in/email`.

**Plans** (`User.plan`): `FREE`, `PRO`, `PREMIUM`. Routes marked ⭐ are gated behind the `PRO` plan via
`requirePlan('PRO')` — FC 26 dataset, scouting, scout playbooks, shortlist, saved searches and the AI coach.

---

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `DATABASE_URL` | PostgreSQL URL through the pooler (Neon + pgbouncer) | ✅ |
| `DIRECT_URL` | Direct PostgreSQL URL (for migrations) | ✅ |
| `BETTER_AUTH_SECRET` | Secret to sign Better Auth sessions (`openssl rand -base64 32`) | ✅ |
| `BETTER_AUTH_URL` | Base API URL (used by Better Auth) | ✅ |
| `TRUSTED_ORIGINS` | Allowed origins for CORS/Better Auth, comma-separated (exact hostnames; **no wildcards**) | ✅ |
| `REDIS_URL` | Redis connection URL | ✅ |
| `FIT_SCORE_SERVICE_URL` | External fit-score service URL (scouting) | ✅ |
| `OPENAI_API_KEY` | OpenAI key — only required for the AI coach (`/chat`) | ⚠️ for chat |
| `OPENAI_CHAT_MODEL` | Chat model | ❌ (default: `gpt-4o-mini`) |
| `PORT` | Server port | ❌ (default: `3333`) |
| `METRICS_TOKEN` | If set, `GET /api/metrics` requires `Authorization: Bearer <token>`; if empty, the endpoint is open | ❌ |
| `DISABLE_RATE_LIMIT` | Disables Better Auth's rate limiter (`true`) — load tests only, never production | ❌ |

---

## Scripts

```bash
npm run dev                   # dev server with hot reload (tsx watch + .env.local)
npm run build                 # compile TypeScript to dist/
npm start                     # production (node dist/server.js)
npm test                      # run tests with Vitest
npm run db:migrate            # create & apply a migration (dev)
npm run db:generate           # regenerate Prisma Client
npm run db:seed               # base seed (clubs, etc.)
npm run db:seed-competitions  # competitions seed
npm run db:seed-fc26          # import the FC 26 player dataset
npm run db:migrate-data       # migrate legacy data
npm run db:studio             # open Prisma Studio
npm run fit-score:clubs:sync  # regenerate the fit-score club-alias map
npm run fit-score:clubs:check # flag drift in the fit-score club aliases
```

Run a single test file:

```bash
npx vitest run src/features/clubs/__tests__/clubs.service.test.ts
```

---

## Folder Structure

```
src/
├── features/
│   ├── auth/             # Authentication (Better Auth)
│   ├── chat/             # AI coach "Mister" (PRO, OpenAI + MCP)
│   ├── clubs/            # Available clubs list (in-memory)
│   ├── club-stints/      # Club spells
│   ├── competitions/     # Competitions (league, cup, european) — cached 24h
│   ├── fc26-players/     # FC 26 player dataset (PRO)
│   ├── health/           # Liveness, fit-score health, Prometheus metrics
│   ├── players/          # Squad & player stats
│   ├── saved-searches/   # Saved scouting filters (PRO)
│   ├── saves/            # Career saves, snapshots, audit, soft-delete
│   ├── scout-playbooks/  # Configurable scouting weights (PRO)
│   ├── scouting/         # Squad gaps, transfer targets, fit evaluation (PRO)
│   ├── shortlist/        # Player shortlists (PRO)
│   ├── team-stats/       # Team stats per competition
│   ├── transfers/        # Transfers
│   └── trophies/         # Trophies
├── mcp/                  # Embedded MCP server (tools + resources)
├── shared/
│   ├── lib/              # auth, prisma, redis, db-retry, fit-score-client, metrics, logger
│   └── utils/            # auth-hooks, cache, rate-limit, currency, errors, cookies, origins, …
├── types/                # Global TypeScript types
├── app.ts                # Fastify — plugins, routes, error handler
└── server.ts             # Entry point
prisma/
├── schema.prisma
├── seed.ts
├── seed-competitions.ts
└── migrate-data.ts
load-test/
├── k6.js                 # k6 load script
└── seed-users.ts         # creates 200 test users
```

---

## Load Testing

The project ships k6 load tests integrated with Grafana + InfluxDB.

### Prerequisites

```bash
docker compose up -d influxdb grafana
```

### Create test users

```bash
npx tsx load-test/seed-users.ts --base-url https://ample-love-production.up.railway.app
```

### Run the test

```bash
k6 run \
  --out influxdb=http://localhost:8086/k6 \
  -e BASE_URL=https://ample-love-production.up.railway.app \
  -e VUS=200 \
  -e DURATION=60s \
  load-test/k6.js
```

Grafana dashboard at `http://localhost:3000`.

> For load tests against production, set `DISABLE_RATE_LIMIT=true` in the server's environment.

---

## CI/CD

### CI — GitHub Actions

The pipeline runs on every push to `main`:

1. `npm ci` — install dependencies
2. `npm run build` — type-check / compile
3. `npm test` — run Vitest

### CD — Railway

Automatic deploy from pushes to `main`. `railway.json` defines:

- **Build**: `npm run build`
- **Pre-deploy**: `npx prisma migrate deploy`
- **Start**: `npm start`
- **Healthcheck**: `/`

---

## Deployment

The API runs on **Railway** (`https://ample-love-production.up.railway.app`). The database is **Neon**
(serverless PostgreSQL) and Redis is a Railway service.

1. Connect the GitHub repo to Railway
2. Configure the environment variables in the Railway dashboard
3. Railway applies `railway.json` automatically on every push

Production migrations run in the pre-deploy step:

```bash
npx prisma migrate deploy
```

> The repo also keeps a `vercel.json` for Vercel compatibility, but production is Railway.

### Maintenance: fit-score club aliases

`src/shared/utils/fit-score-club-aliases.generated.ts` is **generated** and must be re-synced when club
names change (a new FC season or a `fit-score-svc` update). It's a manual local step — it does not run
on deploy:

```bash
npm run fit-score:clubs:sync    # regenerate the file (needs the fit-score-svc venv + club_profiles.pkl)
npm run fit-score:clubs:check   # flag drift when the source changed without a re-sync
```

Full runbook in [docs/.../3.6.9_Scout.md](docs/docs/03_Technical/Modules/3.6.9_Scout.md)
(section "Fit-score club-name aliases").
