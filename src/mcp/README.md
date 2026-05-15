# MCP Server — career-hub

Servidor MCP (Model Context Protocol) embarcado no Fastify, expondo tools e resources read-only sobre dados de saves do Career Hub.

## Endpoint

`POST /mcp` — Streamable HTTP transport, stateless por request.

**Auth:** Bearer token (mesmo token de sessão do Better Auth). 401 sem header ou token inválido.

**Rate limit:** 60 chamadas / 60s por usuário. 429 com header `Retry-After` quando excedido.

## Tools (8)

| Nome | Input | Descrição |
|---|---|---|
| `get_active_save_context` | `saveId?` | Save ativo: clube, temporada, orçamento, saldo |
| `list_saves` | — | Todos os saves do usuário |
| `get_finances` | `saveId?` | Orçamento + saldo + folha salarial total + tamanho do elenco |
| `analyze_squad_by_position` | `saveId?` | Elenco completo agrupado em GK/DEF/MID/ATT |
| `get_season_performance` | `saveId?`, `season?` | Resultados por competição + top 5 artilheiros/assistentes |
| `identify_squad_gaps` | `saveId?`, `formation?` | Lacunas no elenco vs 4-3-3 ou 4-2-3-1 |
| `search_transfer_targets` | `position`, `maxAge?`, `minOverall?`, `maxValue?`, `saveId?` | Até 20 jogadores do dataset FC26 com filtros |
| `evaluate_signing_fit` | `sofifaId`, `saveId?` | Avaliação de uma contratação específica (custo, encaixe, veredito) |

## Resources (2)

| URI | Descrição |
|---|---|
| `playbook://{saveId}` | Pesos e preferências do ScoutPlaybook default daquele save |
| `save://{saveId}/dossier` | Briefing denso: clube, finanças, top 5 elenco, gaps, resultados da temporada atual |

Ambos cacheados 5min em Redis (`mcp:resource:<kind>:<userId>:<saveId>`) e validam ownership.

## Consumo via OpenAI Responses API

```ts
const res = await fetch('https://api.openai.com/v1/responses', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    input: 'Quais são as principais lacunas do meu elenco?',
    tools: [
      {
        type: 'mcp',
        server_label: 'careerhub',
        server_url: 'https://<api-public-url>/mcp',
        headers: { Authorization: `Bearer ${SESSION_TOKEN}` },
        require_approval: 'never',
      },
    ],
  }),
})
```

## Consumo via Claude Desktop

Editar `%APPDATA%\Claude\claude_desktop_config.json` (Windows) ou `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "career-hub": {
      "url": "https://<api-public-url>/mcp",
      "headers": { "Authorization": "Bearer <session-token>" }
    }
  }
}
```

Reinicia o Claude Desktop.

## Estrutura

```
src/mcp/
  plugin.ts           — Fastify route POST /mcp
  auth.ts             — resolveMcpContext (Bearer → userId, cache 5min)
  rate-limit.ts       — counter Redis por userId
  server.ts           — McpServer factory
  context.ts          — McpContext type
  utils.ts            — resolveSaveId helper
  tools/
    index.ts          — registerTools (agrega todas)
    saves.ts          — get_active_save_context, list_saves
    finances.ts       — get_finances
    scouting.ts       — identify_squad_gaps, search_transfer_targets, evaluate_signing_fit
    squad.ts          — analyze_squad_by_position
    performance.ts    — get_season_performance
  resources/
    index.ts          — registerResources
    playbook.ts       — playbook://{saveId}
    dossier.ts        — save://{saveId}/dossier
  __tests__/
    auth.test.ts          — unit tests para resolveMcpContext
    integration.test.ts   — boot Fastify + tools/list + tools/call
```
