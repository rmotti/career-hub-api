# FC 26 Career Hub — API

![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5+-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-4+-000000?logo=fastify&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-5+-2D3748?logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-336791?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-ioredis-DC382D?logo=redis&logoColor=white)
![CI](https://github.com/rmotti/career-hub-api/actions/workflows/ci.yml/badge.svg)

> API para rastreamento de Career Mode do FC 26. Gerencie saves de carreira, elenco, estatísticas por temporada, transferências, troféus e passagens por clubes.

---

## Índice

- [Pré-requisitos](#pré-requisitos)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Banco de Dados](#banco-de-dados)
- [Rotas da API](#rotas-da-api)
- [Autenticação](#autenticação)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Scripts](#scripts)
- [Estrutura de Pastas](#estrutura-de-pastas)
- [Testes de Carga](#testes-de-carga)
- [CI/CD](#cicd)
- [Deploy](#deploy)

---

## Pré-requisitos

- Node.js >= 22
- npm
- PostgreSQL (recomendado: [Neon](https://neon.tech))
- Redis (local ou gerenciado)

---

## Instalação

```bash
git clone https://github.com/rmotti/career-hub-api
cd career-hub-api
npm install
```

---

## Configuração

```bash
cp .env.example .env.local
```

Preencha as variáveis conforme a seção [Variáveis de Ambiente](#variáveis-de-ambiente).

---

## Banco de Dados

**ORM**: Prisma
**Banco**: PostgreSQL (Neon)

### Migrations

```bash
npm run db:migrate           # cria e aplica migration (dev)
npx prisma migrate deploy    # aplica migrations em produção
```

### Seed

```bash
npm run db:seed               # seed principal (clubes, etc.)
npm run db:seed-competitions  # seed de competições
npm run db:migrate-data       # migração de dados legados
```

### Studio

```bash
npm run db:studio
```

### Models

| Model | Descrição |
|---|---|
| `User` | Usuário autenticado (Better Auth) |
| `Session` / `Account` / `Verification` | Modelos de sessão do Better Auth |
| `Save` | Uma carreira no FC 26 |
| `ClubStint` | Passagem por um clube dentro de um save |
| `Player` | Jogador do elenco |
| `PlayerSeasonStats` | Estatísticas do jogador por temporada/clube |
| `PlayerOvrHistory` | Histórico de overall do jogador por temporada |
| `TeamSeasonStats` | Estatísticas da equipe por competição e temporada |
| `Transfer` | Transferência de entrada ou saída |
| `Trophy` | Troféu conquistado vinculado ao ClubStint |
| `Competition` | Competição (liga, copa nacional, europeia, supercopa) |

---

## Rotas da API

Base URL: `http://localhost:3333/api`

Documentação interativa (Swagger): `http://localhost:3333/docs`

### Auth — Pública

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/auth/sign-up/email` | Cadastrar novo usuário |
| `POST` | `/auth/sign-in/email` | Login com e-mail e senha |
| `GET` | `/auth/session` | Verificar sessão ativa |
| `POST` | `/auth/sign-out` | Encerrar sessão |

### Clubs — 🔒 Requer sessão

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/clubs` | Listar todos os clubes disponíveis |
| `GET` | `/clubs/by-league` | Listar clubes agrupados por liga |

### Competitions — 🔒 Requer sessão

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/competitions` | Listar todas as competições |
| `GET` | `/competitions/european` | Listar competições europeias |

### Saves — 🔒 Requer sessão

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/saves` | Listar saves do usuário |
| `GET` | `/saves/:saveId` | Buscar save por ID |
| `POST` | `/saves` | Criar novo save |
| `PATCH` | `/saves/:saveId` | Atualizar save (avançar temporada, budget, europeia) |
| `DELETE` | `/saves/:saveId` | Deletar save e todos os dados relacionados |

**POST `/saves` — body:**
```json
{
  "name": "Minha Carreira",
  "club": "Liverpool",
  "budget": 100,
  "europeanCompetitionId": "uuid-opcional"
}
```
> `budget` em milhões de €: `100` = €100M. O `balance` inicial é igual ao `budget`.

**PATCH `/saves/:saveId` — body:**
```json
{
  "currentYear": 2027,
  "currentSeason": "2027/28",
  "budget": 80,
  "balance": 12,
  "europeanCompetitionId": "uuid-ou-null"
}
```
> Ao alterar `currentSeason`, a API cria `TeamSeasonStats` por competição, `PlayerSeasonStats` para todos os jogadores ativos e verifica troféus da temporada encerrada.

### Club Stints — 🔒 Requer sessão

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/saves/:saveId/club-stints` | Listar passagens por clubes |
| `GET` | `/saves/:saveId/club-stints/current` | Buscar clube atual (`isCurrent: true`) |
| `POST` | `/saves/:saveId/club-stints` | Mudar de clube (fecha stint atual, abre novo em transação) |
| `PATCH` | `/saves/:saveId/club-stints/:stintId` | Atualizar dados da passagem |

**POST — body:**
```json
{
  "club": "Real Madrid",
  "europeanCompetitionId": "uuid-opcional"
}
```
> Operação em transação: fecha o stint anterior, desvincula todos os jogadores e cria `TeamSeasonStats` para as competições do novo clube.

### Players — 🔒 Requer sessão

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/saves/:saveId/players` | Listar jogadores (`?active=true` para elenco ativo, `?season=` para temporada específica) |
| `GET` | `/saves/:saveId/players/:playerId` | Buscar jogador com histórico completo |
| `POST` | `/saves/:saveId/players` | Adicionar jogador ao elenco |
| `PUT` | `/saves/:saveId/players/:playerId` | Atualizar dados do jogador |
| `PATCH` | `/saves/:saveId/players/:playerId/stats` | Atualizar stats da temporada atual |
| `DELETE` | `/saves/:saveId/players/:playerId/release` | Dispensar jogador (sai do elenco, permanece no save) |

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
  "nation": "Brasil",
  "alternativePosition": {
    "positions": ["PD", "SA"]
  },
  "salary": 75,
  "marketValue": 150
}
```
> `salary` em milhares de €: `75` = €75K. `marketValue` em milhões de €: `150` = €150M.
> `alternativePosition.positions` aceita zero ou mais posições secundárias, sem repetir a posição principal.

**Enums válidos:**

| Campo | Valores |
|---|---|
| `position` | `GOL`, `LD`, `LE`, `ZAG`, `VOL`, `MC`, `ME`, `MD`, `MEI`, `PE`, `PD`, `SA`, `ATA` |
| `alternativePosition.positions` | `GOL`, `LD`, `LE`, `ZAG`, `VOL`, `MC`, `ME`, `MD`, `MEI`, `PE`, `PD`, `SA`, `ATA` |
| `status` | `Crucial`, `Important`, `Role`, `Sporadic`, `Promising` |

### Team Stats — 🔒 Requer sessão

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/saves/:saveId/team-stats` | Listar stats por competição (`?season=current` ou `?season=2027/28`) |
| `PATCH` | `/saves/:saveId/team-stats/:statsId` | Atualizar stats de uma competição |

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

**Enum `CupResult`:**

| Valor | Significado |
|---|---|
| `Campeao` | Campeão da competição |
| `Final` | Vice-campeão |
| `Semifinal` | Eliminado nas semifinais |
| `Quartas` | Eliminado nas quartas |
| `OitavasOuFaseDeGrupos` | Eliminado nas oitavas ou fase de grupos |
| `Eliminado` | Eliminado em fase não especificada |
| `NaoParticipou` | Não participou (padrão) |

### Transfers — 🔒 Requer sessão

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/saves/:saveId/transfers` | Listar transferências (`?season=current` para temporada atual) |
| `POST` | `/saves/:saveId/transfers` | Registrar transferência |
| `PUT` | `/saves/:saveId/transfers/:tid` | Atualizar transferência |
| `DELETE` | `/saves/:saveId/transfers/:tid` | Deletar transferência |

**POST — body:**
```json
{
  "playerName": "Kylian Mbappé",
  "type": "compra",
  "from": "Real Madrid",
  "to": "Liverpool",
  "fee": 80,
  "season": "2027/28",
  "playerId": "uuid-opcional"
}
```
> `fee` em milhões de €. Tipos válidos: `compra`, `venda`, `emprestimo_entrada`, `emprestimo_saida`.

### Trophies — 🔒 Requer sessão

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/saves/:saveId/trophies` | Listar troféus com clube e competição |
| `POST` | `/saves/:saveId/trophies` | Adicionar troféu ao ClubStint atual |
| `DELETE` | `/saves/:saveId/trophies/:id` | Deletar troféu |

**POST — body:**
```json
{
  "competitionId": "uuid-da-competicao",
  "year": 2027
}
```
> Use `GET /api/competitions` para obter os UUIDs válidos.

---

## Autenticação

A API utiliza **Better Auth** com sessão via token de portador. A sessão é cacheada no Redis por 5 minutos após a primeira validação.

Inclua o token em todas as rotas protegidas:

```http
Authorization: Bearer <token>
```

O token é obtido em `POST /api/auth/sign-in/email`.

---

## Variáveis de Ambiente

| Variável | Descrição | Obrigatória |
|---|---|---|
| `DATABASE_URL` | URL do PostgreSQL com pooler (Neon + pgbouncer) | ✅ |
| `DIRECT_URL` | URL direta do PostgreSQL (para migrations) | ✅ |
| `BETTER_AUTH_SECRET` | Secret para assinar sessões Better Auth (`openssl rand -base64 32`) | ✅ |
| `BETTER_AUTH_URL` | URL base da API (usada pelo Better Auth) | ✅ |
| `TRUSTED_ORIGINS` | Origens permitidas para CORS (separadas por vírgula) | ✅ |
| `REDIS_URL` | URL de conexão com Redis | ✅ |
| `PORT` | Porta do servidor | ❌ (padrão: `3333`) |
| `DISABLE_RATE_LIMIT` | Desabilita o rate limiter do Better Auth (`true`) — usar apenas em load tests | ❌ |

---

## Scripts

```bash
npm run dev                   # dev com hot reload (tsx watch)
npm run build                 # compila TypeScript para dist/
npm start                     # inicia em produção (node dist/server.js)
npm test                      # roda testes com Vitest
npm run db:migrate            # cria e aplica migration (dev)
npm run db:generate           # regenera Prisma Client
npm run db:seed               # seed principal
npm run db:seed-competitions  # seed de competições
npm run db:migrate-data       # migra dados legados
npm run db:studio             # abre Prisma Studio
```

---

## Estrutura de Pastas

```
src/
├── features/
│   ├── auth/             # Autenticação (Better Auth)
│   ├── clubs/            # Lista de clubes disponíveis (in-memory)
│   ├── club-stints/      # Passagens por clubes
│   ├── competitions/     # Competições (liga, copa, europeia) — cacheadas 24h
│   ├── players/          # Elenco e stats de jogadores
│   ├── saves/            # Saves de carreira
│   ├── team-stats/       # Estatísticas da equipe por competição
│   ├── transfers/        # Transferências
│   └── trophies/         # Troféus
├── shared/
│   ├── lib/
│   │   ├── auth.ts       # Instância do Better Auth
│   │   ├── prisma.ts     # Singleton do Prisma (connection_limit=20)
│   │   └── redis.ts      # Instância do ioredis
│   └── utils/
│       ├── auth-hooks.ts # requireAuth, requireRole, requirePlan
│       ├── cache.ts      # cacheGet / cacheSet / cacheInvalidate
│       ├── currency.ts   # Formatação de valores monetários
│       └── errors.ts     # AppError, NotFoundError
├── types/                # Tipos globais TypeScript
├── app.ts                # Fastify — plugins, rotas, error handler
└── server.ts             # Entry point
prisma/
├── schema.prisma
├── seed.ts
├── seed-competitions.ts
└── migrate-data.ts
load-test/
├── k6.js                 # Script de carga (k6)
└── seed-users.ts         # Cria 200 usuários de teste
```

---

## Testes de Carga

O projeto inclui testes de carga com [k6](https://k6.io) integrados ao Grafana + InfluxDB.

### Pré-requisitos

```bash
docker compose up -d influxdb grafana
```

### Criar usuários de teste

```bash
npx tsx load-test/seed-users.ts --base-url https://ample-love-production.up.railway.app
```

### Rodar o teste

```bash
k6 run \
  --out influxdb=http://localhost:8086/k6 \
  -e BASE_URL=https://ample-love-production.up.railway.app \
  -e VUS=200 \
  -e DURATION=60s \
  load-test/k6.js
```

Dashboard Grafana disponível em `http://localhost:3000`.

> Para testes de carga em produção, configure `DISABLE_RATE_LIMIT=true` nas variáveis de ambiente do servidor.

---

## CI/CD

### CI — GitHub Actions

O pipeline roda a cada push na `main`:

1. `npm ci` — instala dependências
2. `npm run build` — valida TypeScript
3. `npm test` — executa testes com Vitest

### CD — Railway

Deploy automático a partir de pushes na `main`. O `railway.json` define:

- **Build**: `npm run build`
- **Pre-deploy**: `npx prisma migrate deploy`
- **Start**: `npm start`
- **Healthcheck**: `/`

---

## Deploy

A API está hospedada no **Railway** (`https://ample-love-production.up.railway.app`).

1. Conecte o repositório GitHub no Railway
2. Configure as variáveis de ambiente no painel do Railway
3. O Railway aplica o `railway.json` automaticamente a cada push

As migrations de produção rodam no pre-deploy:

```bash
npx prisma migrate deploy
```

### Manutenção: aliases de clube do fit-score

`src/shared/utils/fit-score-club-aliases.generated.ts` é **gerado** e precisa ser re-sincronizado quando os nomes de clube mudam (nova temporada do FC ou atualização do `fit-score-svc`). É um passo manual local — não roda no deploy:

```bash
npm run fit-score:clubs:sync    # regenera o arquivo (precisa do venv + club_profiles.pkl do fit-score-svc)
npm run fit-score:clubs:check   # acusa defasagem se a planilha mudou sem re-sync
```

Runbook completo em [docs/.../3.6.9_Scout.md](docs/docs/03_Technical/Modules/3.6.9_Scout.md) (seção "Fit-score club-name aliases").
