# FC 26 Career Hub — API

![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5+-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-4+-000000?logo=fastify&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-5+-2D3748?logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-336791?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-ioredis-DC382D?logo=redis&logoColor=white)

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
  "salary": 75,
  "marketValue": 150
}
```
> `salary` em milhares de €: `75` = €75K. `marketValue` em milhões de €: `150` = €150M.

**Enums válidos:**

| Campo | Valores |
|---|---|
| `position` | `GOL`, `LD`, `LE`, `ZAG`, `VOL`, `MC`, `ME`, `MD`, `MEI`, `PE`, `PD`, `SA`, `ATA` |
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

A API utiliza **Better Auth** com sessão via token de portador.

Inclua o token em todas as rotas protegidas:

```http
Authorization: Bearer <token>
```

O token é obtido em `POST /api/auth/sign-in/email` e validado via `GET /api/auth/session`.

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

---

## Scripts

```bash
npm run dev                   # dev com hot reload (tsx watch)
npm run build                 # compila TypeScript para dist/
npm start                     # inicia em produção (node dist/server.js)
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
│   ├── clubs/            # Lista de clubes disponíveis
│   ├── club-stints/      # Passagens por clubes
│   ├── competitions/     # Competições (liga, copa, europeia)
│   ├── players/          # Elenco e stats de jogadores
│   ├── saves/            # Saves de carreira
│   ├── team-stats/       # Estatísticas da equipe por competição
│   ├── transfers/        # Transferências
│   └── trophies/         # Troféus
├── shared/
│   ├── lib/              # Instâncias compartilhadas (Prisma, Redis)
│   └── utils/            # Helpers, error handling, auth hooks
├── types/                # Tipos globais TypeScript
├── app.ts                # Fastify — plugins, rotas, error handler
└── server.ts             # Entry point da API
prisma/
├── schema.prisma         # Schema do banco
├── seed.ts               # Seed principal
├── seed-competitions.ts  # Seed de competições
└── migrate-data.ts       # Migração de dados legados
skills/                   # Skills do Claude Code para este projeto
└── docs/                 # Skill de documentação (gera/atualiza este README)
```

---

## CI/CD

O projeto deve usar **GitHub Actions para CI** e **Railway para CD**.

### Estratégia recomendada

1. **CI em pushes para `main`**
   - Instalar dependências com `npm ci`
   - Gerar Prisma Client via `postinstall`
   - Validar TypeScript com `npm run build`
   - Rodar testes com `npm test`

2. **Testes automatizados**
   - Começar com testes unitários de helpers e services sem dependência externa
   - Adicionar testes HTTP com `app.inject()` do Fastify para rotas críticas
   - Adicionar testes de integração com PostgreSQL e Redis via service containers do GitHub Actions

3. **Migrations**
   - Em desenvolvimento, usar `npm run db:migrate`
   - Em produção, usar `npx prisma migrate deploy`
   - Evitar `prisma migrate dev` em ambientes remotos

4. **CD pelo Railway**
   - Railway deve acompanhar a branch de produção do GitHub
   - O deploy deve acontecer a partir dos pushes na branch `main`
   - `railway.json` define build, migration antes do deploy, start e healthcheck
   - As variáveis sensíveis devem ficar no painel do Railway, não no repositório

### Plano de implementação

#### Fase 1 — CI com build e testes

Criar `.github/workflows/ci.yml` para rodar em todo push na `main`:

```yaml
name: CI

on:
  push:
    branches:
      - main

permissions:
  contents: read

jobs:
  build-and-test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm

      - run: npm ci
      - run: npm run build
      - run: npm test
```

#### Fase 2 — Base de testes

Adicionar Vitest e criar scripts:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Os primeiros testes cobrem helpers e services sem dependência de PostgreSQL ou Redis.

#### Fase 3 — Testes de integração

Adicionar um job separado com PostgreSQL e Redis:

- PostgreSQL compatível com o ambiente local (`postgres:16-alpine`)
- Redis compatível com o ambiente local (`redis:7-alpine`)
- `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` e `TRUSTED_ORIGINS` definidos apenas para o job
- `npx prisma migrate deploy` antes dos testes de integração

#### Fase 4 — CD Railway

Configurar no Railway:

- Repositório GitHub conectado
- Branch de produção definida
- Variáveis de ambiente configuradas
- Configuração do deploy versionada em `railway.json`

O arquivo `railway.json` define:

- Build command: `npm run build`
- Pre-deploy command: `npx prisma migrate deploy`
- Start command: `npm start`
- Healthcheck path: `/`

---

## Deploy

### Railway

A API está hospedada no Railway.

1. Conecte o repositório GitHub no Railway
2. Configure a branch de produção
3. Configure as variáveis de ambiente no painel do Railway
4. O Railway usa `railway.json` para aplicar build, pre-deploy migration, start e healthcheck

As migrations de produção rodam no pre-deploy:

```bash
npx prisma migrate deploy
```
