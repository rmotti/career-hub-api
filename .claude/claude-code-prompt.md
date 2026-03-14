# Prompt — FC 26 Career Mode Hub API

## Contexto do projeto

Você vai implementar do zero uma API REST chamada **FC 26 Career Mode Hub**. É um backend para um aplicativo mobile e desktop de tracking de Career Mode do jogo FC 26. O usuário registra sua carreira: clubes, elenco, estatísticas por temporada, transferências e troféus.

---

## Stack a usar (não negociável)

- **Runtime:** Node.js
- **Linguagem:** TypeScript
- **Framework:** Fastify
- **ORM:** Prisma
- **Banco:** PostgreSQL
- **Plugins Fastify:** `@fastify/cors`

---

## Estrutura de pastas a criar

```
fc26-api/
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── src/
│   ├── server.ts
│   ├── app.ts
│   ├── routes/
│   │   ├── saves.routes.ts
│   │   ├── clubStints.routes.ts
│   │   ├── players.routes.ts
│   │   ├── teamStats.routes.ts
│   │   ├── transfers.routes.ts
│   │   ├── trophies.routes.ts
│   │   └── clubs.routes.ts
│   ├── controllers/
│   │   ├── saves.controller.ts
│   │   ├── clubStints.controller.ts
│   │   ├── players.controller.ts
│   │   ├── teamStats.controller.ts
│   │   ├── transfers.controller.ts
│   │   ├── trophies.controller.ts
│   │   └── clubs.controller.ts
│   ├── services/
│   │   ├── saves.service.ts
│   │   ├── clubStints.service.ts
│   │   ├── players.service.ts
│   │   ├── teamStats.service.ts
│   │   ├── transfers.service.ts
│   │   ├── trophies.service.ts
│   │   └── clubs.service.ts
│   ├── lib/
│   │   └── prisma.ts
│   └── utils/
│       └── errors.ts
├── .env.example
├── .gitignore
├── package.json
└── tsconfig.json
```

---

## Diagrama ER (referência para o schema.prisma)

```
Save ||--o{ ClubStint
Save ||--o{ Player
Save ||--o{ Transfer
ClubStint ||--o{ PlayerSeasonStats
ClubStint ||--o{ TeamSeasonStats
ClubStint ||--o{ Trophy
Player ||--o{ PlayerSeasonStats
Transfer }o--o| Player
```

---

## Schema Prisma completo

Implemente o `schema.prisma` com exatamente esses models:

```prisma
model Save {
  id             String      @id @default(uuid())
  name           String
  currentYear    Int         @default(2026)
  currentSeason  String      @default("2026/27")
  budget         String?
  balance        String?
  clubStints     ClubStint[]
  players        Player[]
  transfers      Transfer[]
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt
}

model ClubStint {
  id               String             @id @default(uuid())
  saveId           String
  save             Save               @relation(fields: [saveId], references: [id], onDelete: Cascade)
  club             String
  startYear        String
  endYear          String?
  isCurrent        Boolean            @default(true)
  playerSeasonStats PlayerSeasonStats[]
  teamSeasonStats  TeamSeasonStats[]
  trophies         Trophy[]
  players          Player[]           @relation("ActiveClubStint")
  createdAt        DateTime           @default(now())
}

model Player {
  id                String             @id @default(uuid())
  saveId            String
  save              Save               @relation(fields: [saveId], references: [id], onDelete: Cascade)
  activeClubStintId String?
  activeClubStint   ClubStint?         @relation("ActiveClubStint", fields: [activeClubStintId], references: [id])
  name              String
  position          Position
  age               Int
  status            PlayerStatus
  ovr               Int
  salary            String?
  marketValue       String?
  seasonStats       PlayerSeasonStats[]
  transfers         Transfer[]
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt
}

model PlayerSeasonStats {
  id           String    @id @default(uuid())
  playerId     String
  player       Player    @relation(fields: [playerId], references: [id], onDelete: Cascade)
  clubStintId  String
  clubStint    ClubStint @relation(fields: [clubStintId], references: [id], onDelete: Cascade)
  season       String
  goals        Int       @default(0)
  assists      Int       @default(0)
  yellowCards  Int       @default(0)
  redCards     Int       @default(0)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
}

model TeamSeasonStats {
  id            String    @id @default(uuid())
  clubStintId   String
  clubStint     ClubStint @relation(fields: [clubStintId], references: [id], onDelete: Cascade)
  season        String
  goalsPro      Int       @default(0)
  goalsAgainst  Int       @default(0)
  possession    Int       @default(0)
  wins          Int       @default(0)
  draws         Int       @default(0)
  losses        Int       @default(0)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

model Transfer {
  id          String       @id @default(uuid())
  saveId      String
  save        Save         @relation(fields: [saveId], references: [id], onDelete: Cascade)
  playerId    String?
  player      Player?      @relation(fields: [playerId], references: [id])
  playerName  String
  type        TransferType
  from        String
  to          String
  fee         String?
  season      String
  createdAt   DateTime     @default(now())
}

model Trophy {
  id           String    @id @default(uuid())
  clubStintId  String
  clubStint    ClubStint @relation(fields: [clubStintId], references: [id], onDelete: Cascade)
  name         String
  year         Int
  createdAt    DateTime  @default(now())
}

enum Position {
  GOL
  ZAG
  MEI
  ATA
}

enum PlayerStatus {
  Crucial
  Important
  Role
  Sporadic
  Promising
}

enum TransferType {
  compra
  venda
}
```

---

## Endpoints a implementar

### GET /api/clubs
Retorna lista estática de clubes (seed no banco ou array hardcoded no service). Inclua pelo menos 30 clubes reais do FC 26 (Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Brasileirão).

---

### Saves — /api/saves

**GET /api/saves**
Lista todos os saves. Incluir `currentClubStint` (o ClubStint com `isCurrent: true`) em cada save.

**GET /api/saves/:saveId**
Retorna save completo com `clubStints[]` e `currentClubStint`.

**POST /api/saves**
Body: `{ name: string, club: string }`
Lógica obrigatória no service:
1. Criar o Save com `currentYear: 2026`, `currentSeason: "2026/27"`
2. Criar ClubStint com `isCurrent: true`, `startYear: "2026"`
3. Criar TeamSeasonStats vazio para a season "2026/27" vinculado ao ClubStint
4. Validar que `club` existe na lista de clubes

**PATCH /api/saves/:saveId**
Body: `{ currentYear?: number, currentSeason?: string, budget?: string, balance?: string }`
Quando `currentSeason` mudar (avanço de temporada), lógica obrigatória:
1. Atualizar o Save
2. Criar novo `TeamSeasonStats` vazio para a nova season no ClubStint atual
3. Para cada Player com `activeClubStintId` igual ao ClubStint atual, criar `PlayerSeasonStats` vazio para a nova season

**DELETE /api/saves/:saveId**
Deletar save e todos os dados relacionados (cascade já garante no Prisma).

---

### Club Stints — /api/saves/:saveId/club-stints

**GET /api/saves/:saveId/club-stints**
Lista todas as passagens do save.

**GET /api/saves/:saveId/club-stints/current**
Retorna o ClubStint com `isCurrent: true`.

**POST /api/saves/:saveId/club-stints**
Body: `{ club: string }`
⚠️ Operação CRÍTICA — deve ser uma transação Prisma (`prisma.$transaction`):
1. Buscar o ClubStint atual (`isCurrent: true`)
2. Fechar o ClubStint anterior: setar `isCurrent: false` e `endYear` com o `currentYear` do Save
3. Criar novo ClubStint com `isCurrent: true` e `startYear` igual ao `currentYear` do Save
4. Criar `TeamSeasonStats` vazio para a `currentSeason` do Save, vinculado ao novo ClubStint
5. Desvincular todos os jogadores: setar `activeClubStintId: null` em todos os Players do Save que tinham o stint anterior

**PATCH /api/saves/:saveId/club-stints/:stintId**
Body: `{ club?: string, startYear?: string, endYear?: string }`
Atualização simples dos dados da passagem.

---

### Players — /api/saves/:saveId/players

**GET /api/saves/:saveId/players?active=true**
Quando `active=true`: retorna apenas players com `activeClubStintId` igual ao ClubStint atual, incluindo `seasonStats` da `currentSeason`.
Sem query param: retorna todos os players do save com `totalStats` (soma de todos os PlayerSeasonStats).

**GET /api/saves/:saveId/players/:playerId**
Retorna player com `totalStats` e array `history` com todas as temporadas:
```json
{
  "id": "...",
  "name": "...",
  "totalStats": { "goals": 30, "assists": 12, "yellowCards": 15, "redCards": 1 },
  "history": [
    { "club": "Nottingham Forest", "season": "2026/27", "goals": 3, "assists": 1, "yellowCards": 2, "redCards": 0 }
  ]
}
```
O `totalStats` é calculado somando todos os `PlayerSeasonStats` do jogador.
O `history` é montado fazendo JOIN com `ClubStint` para obter o nome do clube.

**POST /api/saves/:saveId/players**
Body: `{ name, position, age, status, ovr, salary?, marketValue? }`
Lógica:
1. Criar o Player vinculado ao Save
2. Setar `activeClubStintId` com o ClubStint atual (`isCurrent: true`)
3. Criar `PlayerSeasonStats` vazio para a `currentSeason` do Save

**PUT /api/saves/:saveId/players/:playerId**
Body: todos os campos do Player (exceto id, saveId)
Atualiza dados do jogador.

**PATCH /api/saves/:saveId/players/:playerId/stats**
Body: `{ goals?, assists?, yellowCards?, redCards? }`
Atualiza o `PlayerSeasonStats` da `currentSeason` do jogador no ClubStint atual.

**DELETE /api/saves/:saveId/players/:playerId/release**
Setar `activeClubStintId: null` no player (não deleta o registro, apenas desvincula do elenco ativo).

---

### Team Season Stats — /api/saves/:saveId/team-stats

**GET /api/saves/:saveId/team-stats?season=current**
Quando `season=current`: retorna `TeamSeasonStats` da `currentSeason` do ClubStint atual.
Sem query param: retorna todos os TeamSeasonStats de todos os ClubStints do Save.

**PATCH /api/saves/:saveId/team-stats/:statsId**
Body: `{ goalsPro?, goalsAgainst?, possession?, wins?, draws?, losses? }`
Atualiza os stats. Validar que `possession` está entre 0 e 100.

---

### Transfers — /api/saves/:saveId/transfers

**GET /api/saves/:saveId/transfers?season=current**
Quando `season=current`: filtra por `season` igual a `currentSeason` do Save.
Sem query param: retorna todas as transferências.

**POST /api/saves/:saveId/transfers**
Body: `{ playerName, type, from, to, fee?, season, playerId? }`
⚠️ Operação CRÍTICA com lógica condicional:

Se `type === "compra"`:
1. Registrar a Transfer
2. Se `playerId` fornecido: reativar o player existente setando `activeClubStintId` com o ClubStint atual + criar `PlayerSeasonStats` vazio para a season atual se não existir
3. Se `playerId` não fornecido: criar novo Player com dados mínimos (nome, position="MEI" como default) + vincular ao ClubStint atual + criar `PlayerSeasonStats` vazio

Se `type === "venda"`:
1. Registrar a Transfer
2. Se `playerId` fornecido: setar `activeClubStintId: null` no Player

Toda essa lógica deve ser uma `prisma.$transaction`.

**PUT /api/saves/:saveId/transfers/:tid**
Atualiza dados da transferência.

**DELETE /api/saves/:saveId/transfers/:tid**
Remove a transferência.

---

### Trophies — /api/saves/:saveId/trophies

**GET /api/saves/:saveId/trophies**
Lista todos os troféus do save, incluindo o nome do clube (derivado do ClubStint relacionado).

**POST /api/saves/:saveId/trophies**
Body: `{ name: string, year: number }`
Vincular ao ClubStint atual do Save.

**DELETE /api/saves/:saveId/trophies/:id**
Remove o troféu.

---

## Validações obrigatórias (usar JSON Schema do Fastify)

| Campo | Regra |
|-------|-------|
| `Player.age` | inteiro, mínimo 15, máximo 45 |
| `Player.ovr` | inteiro, mínimo 40, máximo 99 |
| `Player.position` | enum: GOL, ZAG, MEI, ATA |
| `Player.status` | enum: Crucial, Important, Role, Sporadic, Promising |
| `Transfer.type` | enum: compra, venda |
| `Transfer.season` | string, pattern `^\d{4}\/\d{2}$` |
| `TeamSeasonStats.possession` | inteiro, mínimo 0, máximo 100 |
| `Save.name` | string, obrigatório, minLength 1 |
| `ClubStint.club` | validar no service contra lista de /api/clubs |

---

## Tratamento de erros

Criar um handler global no Fastify para retornar erros no formato:
```json
{ "error": "Mensagem de erro", "statusCode": 404 }
```

Tratar os casos:
- Recurso não encontrado (404)
- Dados inválidos / validação falhou (400)
- Erro interno (500)

---

## Arquivo .env.example

```
DATABASE_URL="postgresql://user:password@localhost:5432/fc26_career_hub"
PORT=3333
```

---

## package.json — scripts obrigatórios

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "db:migrate": "prisma migrate dev",
    "db:generate": "prisma generate",
    "db:seed": "tsx prisma/seed.ts",
    "db:studio": "prisma studio"
  }
}
```

---

## Ordem de implementação

Siga exatamente essa ordem para evitar erros de dependência:

1. Inicializar projeto com `npm init`, instalar dependências, configurar `tsconfig.json`
2. Criar `prisma/schema.prisma` e rodar `prisma migrate dev --name init`
3. Criar `src/lib/prisma.ts` (singleton do PrismaClient)
4. Criar `src/app.ts` (instância do Fastify com plugins) e `src/server.ts` (start)
5. Implementar `clubs` (mais simples, valida o setup)
6. Implementar `saves` (CRUD + lógica de avanço de temporada)
7. Implementar `club-stints` (com transaction)
8. Implementar `players` (com queries de stats)
9. Implementar `team-stats`
10. Implementar `transfers` (com transaction)
11. Implementar `trophies`
12. Criar `prisma/seed.ts` com dados de exemplo
13. Testar todos os endpoints

---

## Observações finais

- Use `async/await` em todo o código, sem callbacks
- Todas as operações de banco que envolvem múltiplas escritas **devem usar `prisma.$transaction`**
- O `PrismaClient` deve ser um singleton (um único arquivo `src/lib/prisma.ts` exportando a instância)
- Não usar `any` no TypeScript — inferir os tipos pelo Prisma Client sempre que possível
- Ao final, o projeto deve rodar com `npm run dev` sem erros