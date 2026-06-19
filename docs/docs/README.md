# FC Career Hub API — Documentation

Living documentation of the **fc26-career-hub-api**, generated from the current state of the repository (Fastify + Prisma + PostgreSQL + Redis). Each file is self-contained and ends with a verification footer pointing at the commit it was last reconciled against.

This is the **backend** documentation. The companion React SPA that consumes this API is a separate repository.

## Structure

### [01_Product](01_Product/)
- [1.1 Overview](01_Product/1.1_Overview.md) — what the service is, who consumes it, and the value it delivers.
- [1.2 Roadmap](01_Product/1.2_Roadmap.md) — direction by horizon (hardening, depth, reach).

### [02_Domain](02_Domain/)
- [2.1 Business Rules](02_Domain/2.1_Business_Rules.md) — domain rules extracted from code (Prisma schema, services, guards).

### [03_Technical](03_Technical/)
- [3.1 Architecture](03_Technical/3.1_Architecture.md) — Fastify feature layout, request lifecycle, plugin topology.
- [3.2 Data Model and Persistence](03_Technical/3.2_Data_Model.md) — Prisma schema, relations, Redis cache strategy, currency units.
- [3.3 API Reference and Integrations](03_Technical/3.3_API_and_Integrations.md) — every endpoint, response envelopes, error contract, external services.
- [3.4 Code Standards](03_Technical/3.4_Code_Standards.md) — conventions, file organization, validation, testing.

### [03_Technical/Modules](03_Technical/Modules/)
One file per feature folder (`src/features/<name>/`), grouped by responsibility:

- [3.6.1 Auth and Sessions](03_Technical/Modules/3.6.1_Auth.md)
- [3.6.2 Saves and Careers](03_Technical/Modules/3.6.2_Saves.md)
- [3.6.3 Club Stints](03_Technical/Modules/3.6.3_Club_Stints.md)
- [3.6.4 Players (Squad)](03_Technical/Modules/3.6.4_Players.md)
- [3.6.5 Transfers](03_Technical/Modules/3.6.5_Transfers.md)
- [3.6.6 Team Stats and Trophies](03_Technical/Modules/3.6.6_Team_Stats_and_Trophies.md)
- [3.6.7 Competitions and Clubs](03_Technical/Modules/3.6.7_Competitions_and_Clubs.md)
- [3.6.8 FC26 Dataset](03_Technical/Modules/3.6.8_FC26_Dataset.md)
- [3.6.9 Scout (Playbooks, Scoring, Shortlist, Saved Searches, Scouting)](03_Technical/Modules/3.6.9_Scout.md)
- [3.6.10 Chat (Junior / Mister)](03_Technical/Modules/3.6.10_Chat.md)
- [3.6.11 MCP Server](03_Technical/Modules/3.6.11_MCP_Server.md)

### [04_Next_Steps](04_Next_Steps/)
The item-level backlog the [Roadmap](01_Product/1.2_Roadmap.md) themes resolve into, split so each item lives in exactly one place:
- [4.0 Overview & Progressive Plan](04_Next_Steps/4.0_Overview.md) — FE/API split of the current backlog and the phased plan.
- [4.1 Corrections](04_Next_Steps/4.1_Corrections.md) — defects: actual behavior diverges from intended.
- [4.2 Features](04_Next_Steps/4.2_Features.md) — net-new capability the API doesn't have today.
- [4.3 Improvements](04_Next_Steps/4.3_Improvements.md) — non-functional polish of already-correct behavior.
- [4.4 Business Rule Changes](04_Next_Steps/4.4_Business_Rule_Changes.md) — deliberate redefinition of a domain rule (links [2.1](02_Domain/2.1_Business_Rules.md)).

### Top-level
- [AI_RULES.md](AI_RULES.md) — operational rules for AI agents working in this repo.

## Recommended Reading Order

### For product / strategy
1. [1.1 Overview](01_Product/1.1_Overview.md)
2. [1.2 Roadmap](01_Product/1.2_Roadmap.md)

### For engineering
1. [AI_RULES.md](AI_RULES.md)
2. [3.1 Architecture](03_Technical/3.1_Architecture.md)
3. [3.2 Data Model and Persistence](03_Technical/3.2_Data_Model.md)
4. [3.3 API Reference and Integrations](03_Technical/3.3_API_and_Integrations.md)
5. [Modules](03_Technical/Modules/) — the one(s) you'll touch.

### For AI agents (first-touch)
1. [AI_RULES.md](AI_RULES.md) — always.
2. [3.1 Architecture](03_Technical/3.1_Architecture.md) for the feature layout.
3. The specific [Module](03_Technical/Modules/) doc for the area you're editing.

## Conventions

- Each technical doc ends with an **Auto-audit** section that distinguishes what is confirmed in code from what was inferred.
- All routes are served under the `/api` prefix (e.g., `/api/saves`). Auth is via `Authorization: Bearer <token>`.
- Live OpenAPI/Swagger UI is served by the running service at `/docs`.
- Docs in `docs/` are written in English; the API's own user-facing error messages are in Portuguese (PT-BR).

_Last verified against commit `d52d3a7`._
