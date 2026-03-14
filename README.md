# FC 26 Career Mode Hub — API

Backend REST para tracking de Career Mode do FC 26. Registre sua carreira com detalhes completos: clubes, elenco, estatísticas por temporada, transferências e troféus — tudo persistido e consultável via API.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js |
| Linguagem | TypeScript (strict) |
| Framework | Fastify v4 |
| ORM | Prisma v5 |
| Banco de dados | PostgreSQL |
| Documentação | Swagger UI (`@fastify/swagger-ui`) |
| Infra local | Docker + docker-compose |

---

## Funcionalidades

- **Múltiplos saves** — gerencie carreiras diferentes em paralelo
- **Histórico de clubes** — registre cada passagem com anos de início e fim
- **Elenco ativo** — controle quais jogadores estão no clube atual
- **Stats por temporada** — tanto individuais (gols, assistências, cartões) quanto da equipe (vitórias, posse, gols pro/contra, posição na liga, resultado nas copas)
- **Orçamento e saldo** — `budget` fixo por temporada; `balance` atualizado automaticamente a cada compra ou venda
- **Avanço de temporada automático** — ao atualizar `currentSeason`, a API cria registros de stats vazios para todos os jogadores ativos e para a equipe
- **Troféus automáticos** — ao avançar de temporada, troféus são criados automaticamente se `leaguePosition === 1`, `europeanCupResult === "Campeao"` ou `nationalCupResult === "Campeao"`
- **Transferências** — compras reativam/criam jogadores no elenco e debitam o `balance`; vendas desvinculam e creditam o `balance`
- **Formato de moeda normalizado** — `salary` e `marketValue` seguem o padrão `€750K` / `€1.5M`
- **Validações** — JSON Schema integrado ao Fastify (idade, OVR, posse, enums de posição/status/cupResult, padrão de moeda)
- **Swagger UI** — documentação interativa em `/docs`

---

## Diagrama de dados

```
Save ──< ClubStint ──< TeamSeasonStats
  |           |──< Trophy
  |           |──< PlayerSeasonStats >── Player
  |                                         |
  └──< Player                               |
  └──< Transfer >──────────────────────────┘
```

- Um **Save** possui várias passagens por clubes (`ClubStint`), jogadores e transferências
- Apenas um `ClubStint` tem `isCurrent: true` por vez
- `PlayerSeasonStats` conecta um jogador a um stint e a uma temporada específica
- `Transfer` pode ou não referenciar um `Player` existente
- `budget` é o orçamento original da temporada e nunca muda; `balance` flutua conforme as transferências

---

## Pré-requisitos

- [Node.js](https://nodejs.org) 20+
- [Docker](https://www.docker.com/) (para o banco local)

---

## Instalação e execução

```bash
# 1. Clone o repositório
git clone <repo-url>
cd fc26-career-hub-api

# 2. Instale as dependências
npm install

# 3. Configure as variáveis de ambiente
cp .env.example .env
# edite o .env se necessário (padrão já aponta para o Docker local)

# 4. Suba o banco de dados
docker compose up -d

# 5. Execute as migrations
npm run db:migrate

# 6. (Opcional) Popule com dados de exemplo
npm run db:seed

# 7. Inicie o servidor em modo desenvolvimento
npm run dev
```

A API estará disponível em `http://localhost:3333`.
A documentação Swagger em `http://localhost:3333/docs`.

---

## Variáveis de ambiente

| Variável | Descrição | Exemplo |
|---|---|---|
| `DATABASE_URL` | URL do banco (pooler se usar Neon) | `postgresql://fc26:fc26@localhost:5432/fc26_career_hub` |
| `DIRECT_URL` | URL direta (obrigatória para migrations no Neon) | igual à `DATABASE_URL` para uso local |
| `PORT` | Porta do servidor | `3333` |

---

## Scripts

| Comando | Descrição |
|---|---|
| `npm run dev` | Inicia em modo watch (tsx) |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm run start` | Executa o build compilado |
| `npm run db:migrate` | Cria/atualiza tabelas no banco |
| `npm run db:generate` | Regenera o Prisma Client |
| `npm run db:seed` | Insere dados de exemplo |
| `npm run db:studio` | Abre o Prisma Studio (GUI do banco) |

---

## Formato de moeda

Todos os campos monetários (`salary`, `marketValue`, `budget`, `balance`, `fee`) seguem o padrão:

| Valor | Formato |
|---|---|
| Abaixo de 1.000.000 | `€750K`, `€100K` |
| A partir de 1.000.000 | `€1.5M`, `€35M`, `€100M` |

- Prefixo `€` obrigatório
- Sufixo `K` (milhares) ou `M` (milhões) obrigatório, maiúsculo
- Exemplos válidos: `€750K`, `€1.5M`, `€85M`, `€100K`
- Exemplos inválidos: `750000`, `35M`, `€35m`, `£80M`

---

## Endpoints

### Clubs

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/clubs` | Lista todos os clubes disponíveis |

---

### Saves

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/saves` | Lista todos os saves com `currentClubStint` |
| GET | `/api/saves/:saveId` | Busca save com todos os `clubStints` |
| POST | `/api/saves` | Cria save + ClubStint inicial + TeamSeasonStats |
| PATCH | `/api/saves/:saveId` | Atualiza save; avança temporada se `currentSeason` mudar |
| DELETE | `/api/saves/:saveId` | Remove save e todos os dados (cascade) |

**POST `/api/saves` — body:**
```json
{
  "name": "Minha Carreira",
  "club": "Liverpool",
  "budget": "€100M"
}
```

> `budget` é obrigatório. O `balance` inicial é automaticamente igual ao `budget`.

**PATCH `/api/saves/:saveId` — body:**
```json
{
  "currentYear": 2027,
  "currentSeason": "2027/28",
  "budget": "€80M",
  "balance": "€12M"
}
```

> Ao alterar `currentSeason`, a API:
> 1. Verifica os `TeamSeasonStats` da temporada que está encerrando
> 2. Cria troféus automaticamente conforme os resultados (ver [Troféus automáticos](#troféus-automáticos))
> 3. Cria `TeamSeasonStats` e `PlayerSeasonStats` vazios para a nova temporada

---

### Club Stints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/saves/:saveId/club-stints` | Lista todas as passagens |
| GET | `/api/saves/:saveId/club-stints/current` | Retorna o clube atual |
| POST | `/api/saves/:saveId/club-stints` | Muda de clube (transação) |
| PATCH | `/api/saves/:saveId/club-stints/:stintId` | Edita dados da passagem |

**POST** — muda de clube em transação: fecha o stint anterior, desvincula jogadores, abre novo stint e cria TeamSeasonStats.

```json
{ "club": "Real Madrid" }
```

---

### Players

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/saves/:saveId/players` | Todos os jogadores com `totalStats` acumulado |
| GET | `/api/saves/:saveId/players?active=true` | Apenas elenco ativo com stats da temporada atual |
| GET | `/api/saves/:saveId/players/:playerId` | Jogador com `totalStats` e `history` por clube/temporada |
| POST | `/api/saves/:saveId/players` | Adiciona jogador ao elenco |
| PUT | `/api/saves/:saveId/players/:playerId` | Atualiza dados do jogador |
| PATCH | `/api/saves/:saveId/players/:playerId/stats` | Atualiza stats da temporada atual |
| DELETE | `/api/saves/:saveId/players/:playerId/release` | Dispensa (seta `activeClubStintId: null`) |

**POST `/api/saves/:saveId/players` — body:**
```json
{
  "name": "Vinícius Jr.",
  "position": "ATA",
  "age": 26,
  "status": "Crucial",
  "ovr": 91,
  "salary": "€750K",
  "marketValue": "€85M"
}
```

> `salary` e `marketValue` são opcionais mas devem seguir o [formato de moeda](#formato-de-moeda) quando informados.

**Resposta de GET `/:playerId`:**
```json
{
  "id": "...",
  "name": "Vinícius Jr.",
  "totalStats": { "goals": 47, "assists": 30, "yellowCards": 8, "redCards": 0 },
  "history": [
    { "club": "Real Madrid", "season": "2026/27", "goals": 22, "assists": 15, "yellowCards": 3, "redCards": 0 },
    { "club": "Liverpool", "season": "2027/28", "goals": 25, "assists": 15, "yellowCards": 5, "redCards": 0 }
  ]
}
```

**Enums válidos:**

| Campo | Valores |
|---|---|
| `position` | `GOL`, `ZAG`, `MEI`, `ATA` |
| `status` | `Crucial`, `Important`, `Role`, `Sporadic`, `Promising` |

---

### Team Stats

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/saves/:saveId/team-stats` | Todos os stats de todos os clubes |
| GET | `/api/saves/:saveId/team-stats?season=current` | Stats da temporada atual |
| PATCH | `/api/saves/:saveId/team-stats/:statsId` | Atualiza stats |

**PATCH — body:**
```json
{
  "goalsPro": 55,
  "goalsAgainst": 22,
  "possession": 57,
  "wins": 24,
  "draws": 5,
  "losses": 9,
  "leaguePosition": 1,
  "europeanCupResult": "Campeao",
  "nationalCupResult": "Semifinal"
}
```

> - `possession` deve estar entre 0 e 100
> - `leaguePosition` é inteiro, mínimo 1
> - Ao avançar de temporada, `leaguePosition === 1` ou resultados `"Campeao"` nas copas geram troféus automaticamente

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

---

### Transfers

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/saves/:saveId/transfers` | Todas as transferências |
| GET | `/api/saves/:saveId/transfers?season=current` | Transferências da temporada atual |
| POST | `/api/saves/:saveId/transfers` | Registra transferência (transação) |
| PUT | `/api/saves/:saveId/transfers/:tid` | Atualiza transferência |
| DELETE | `/api/saves/:saveId/transfers/:tid` | Remove transferência |

**POST — body:**
```json
{
  "playerName": "Kylian Mbappé",
  "type": "compra",
  "from": "Real Madrid",
  "to": "Liverpool",
  "fee": "€80M",
  "season": "2027/28",
  "playerId": "uuid-opcional"
}
```

**Lógica por tipo:**

| Tipo | `playerId` fornecido | Comportamento |
|---|---|---|
| `compra` | Sim | Reativa player existente + cria PlayerSeasonStats se não existir |
| `compra` | Não | Cria novo player com dados mínimos e vincula ao elenco |
| `venda` | Sim | Seta `activeClubStintId: null` no player |
| `venda` | Não | Apenas registra a transferência |

> - O `balance` do save é atualizado automaticamente: **compra** debita o `fee`; **venda** credita o `fee`. Se `fee` for nulo ou `€0`, o `balance` não é alterado.
> - O formato de `season` deve ser `YYYY/YY` (ex: `2027/28`).
> - `fee` deve seguir o [formato de moeda](#formato-de-moeda).

---

### Trophies

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/saves/:saveId/trophies` | Lista troféus com nome do clube |
| POST | `/api/saves/:saveId/trophies` | Adiciona troféu ao clube atual |
| DELETE | `/api/saves/:saveId/trophies/:id` | Remove troféu |

**POST — body:**
```json
{
  "name": "Premier League",
  "year": 2027
}
```

**Resposta de GET:**
```json
[
  {
    "id": "uuid",
    "name": "Manchester City — Campeão da Liga 2026/27",
    "year": 2027,
    "club": "Manchester City"
  }
]
```

---

### Troféus automáticos

Ao chamar `PATCH /api/saves/:saveId` com uma `currentSeason` diferente, a API verifica o `TeamSeasonStats` da temporada que está encerrando e cria troféus automaticamente:

| Condição | Troféu gerado |
|---|---|
| `leaguePosition === 1` | `"<Clube> — Campeão da Liga <temporada>"` |
| `europeanCupResult === "Campeao"` | `"<Clube> — Campeão Europeu <temporada>"` |
| `nationalCupResult === "Campeao"` | `"<Clube> — Campeão da Copa Nacional <temporada>"` |

Toda a criação de troféus + stats da nova temporada ocorre em uma única transação Prisma.

---

## Tratamento de erros

Todos os erros retornam no formato:

```json
{
  "error": "Mensagem descritiva",
  "statusCode": 404
}
```

| Status | Situação |
|---|---|
| 400 | Validação de schema falhou, formato de moeda inválido ou regra de negócio violada |
| 404 | Recurso não encontrado |
| 500 | Erro interno inesperado |

---

## Casos de uso típicos

**Iniciar uma carreira:**
1. `GET /api/clubs` — escolha um clube
2. `POST /api/saves` — crie o save com nome, clube e `budget` inicial
3. `POST /api/saves/:saveId/players` — adicione jogadores ao elenco

**Janela de transferências:**
1. `POST /api/saves/:saveId/transfers` com `type: "venda"` — venda jogadores (credita `balance`)
2. `POST /api/saves/:saveId/transfers` com `type: "compra"` — contrate jogadores (debita `balance`)

**Fechar uma temporada:**
1. `PATCH /api/saves/:saveId/team-stats/:statsId` — atualize stats finais incluindo `leaguePosition`, `europeanCupResult` e `nationalCupResult`
2. `PATCH /api/saves/:saveId/players/:playerId/stats` — atualize stats individuais
3. `PATCH /api/saves/:saveId` — avance a `currentSeason` (cria troféus automáticos + novos registros de stats)

**Mudar de clube:**
1. `POST /api/saves/:saveId/club-stints` — registra a mudança, fecha o stint anterior e desvincula todo o elenco

---

## Estrutura do projeto

```
├── prisma/
│   ├── schema.prisma       # Models e enums
│   └── seed.ts             # Dados de exemplo
├── src/
│   ├── app.ts              # Fastify + plugins + error handler
│   ├── server.ts           # Bootstrap do servidor
│   ├── lib/
│   │   └── prisma.ts       # Singleton do PrismaClient
│   ├── utils/
│   │   ├── errors.ts       # AppError / NotFoundError
│   │   └── currency.ts     # formatCurrency / parseCurrency / isValidCurrencyFormat
│   ├── routes/             # Definição de rotas + schemas Swagger
│   ├── controllers/        # Handlers HTTP (request → service → reply)
│   └── services/           # Regras de negócio + queries Prisma
├── docker-compose.yml
├── .env.example
└── tsconfig.json
```
