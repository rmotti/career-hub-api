# MCP Server — career-hub

Servidor MCP (Model Context Protocol) embarcado no Fastify, expondo tools e resources read-only sobre dados de saves do Career Hub.

## Endpoint

`POST /mcp` — Streamable HTTP transport, stateless por request.

**Auth:** Bearer token (mesmo token de sessão do Better Auth). 401 sem header ou token inválido.

**Rate limit:** 60 chamadas / 60s por usuário. 429 com header `Retry-After` quando excedido.

## Save em contexto

O token efêmero do chat (`mintMcpToken(userId, saveId?)`) é **fixado na save da conversa**.
As tools resolvem a save nesta ordem: `saveId` explícito do argumento → `ctx.saveId` (a save da
conversa) → save atualizada mais recentemente. Assim o bot responde sobre a save certa mesmo se
o usuário tem várias.

No **primeiro turno** de uma conversa fixada numa save, o chat anexa automaticamente o JSON do
dossiê (`getSaveDossierJson`) ao input — o modelo já começa aterrado, sem depender de chamar uma
tool. Nos turnos seguintes o dossiê não é reenviado (já vive na cadeia via `previousResponseId`).

## Tools (26)

**Contexto & estado**
| Nome | Input | Descrição |
|---|---|---|
| `get_active_save_context` | `saveId?` | Save ativo: clube, temporada, orçamento, saldo |
| `list_saves` | — | Todos os saves do usuário |
| `get_finances` | `saveId?` | Orçamento + saldo + folha salarial total + tamanho do elenco |
| `get_season_performance` | `saveId?`, `season?` | Resultados por competição + top 5 artilheiros/assistentes |

**Leitura de elenco**
| Nome | Input | Descrição |
|---|---|---|
| `analyze_squad_needs` | `formation?`, `saveId?` | **Primária p/ "do que preciso".** Profundidade por setor + gaps + objetivo do playbook + lente estratégica, numa chamada |
| `analyze_squad_by_position` | `saveId?` | Elenco completo (GK/DEF/MID/ATT) com OVR/potencial, status, salário, valor + sumário por setor |
| `identify_squad_gaps` | `saveId?`, `formation?` | Lacunas vs a formação dada (qualquer separador; default 4-3-3; nível baixo; `analyze_squad_needs` já inclui) |

**Scouting de mercado**
| Nome | Input | Descrição |
|---|---|---|
| `find_player` | `name`, `limit?` | Resolve **nome → sofifaId canônico** (+ clube, posições, OVR, valor). Usar antes de evaluate/shortlist quando o usuário cita um nome |
| `recommend_signings` | `position?`, `maxAge?`, `minOverall?`, `minPotential?`, `maxMarketValue?`, `objective?`, `playbookId?`, `limit?`, `saveId?` | **Primária p/ "quem contratar".** Jogadores ranqueados por **scoutScore** (playbook + orçamento + fit) |
| `plan_transfer_window` | `formation?`, `maxTargets?`, `saveId?` | Plano de janela: necessidades por severidade → melhor alvo acessível por scoutScore, descontando do orçamento |
| `get_club_archetype` | `position`, `objective?`, `includeRecentSignings?`, `saveId?` | **Club DNA**: idade/nacionalidades/ligas típicas + contratações recentes |
| `search_transfer_targets` | `position`, `maxAge?`, `minOverall?`, `maxValue?`, `saveId?` | Lista filtrada por OVR cru (sem scoutScore) |
| `scout_hidden_gems` | `mode?`, `position?`, `maxAge?`, `maxValue?`, `minPotential?` | **Garimpo** fora das 5 primeiras divisões de elite (+ ligas femininas); modos `upside` (potencial − OVR) e `value` (OVR por €M). Sem scoutScore |
| `evaluate_signing_fit` | `sofifaId`, `saveId?` | Avaliação de uma contratação (custo, encaixe, veredito, alternativas) |
| `compare_players` | `sofifaIds?`, `names?`, `saveId?` | Compara 2–4 jogadores lado a lado (OVR/pot/idade/valor + scoutScore/fitScore) |
| `list_scout_playbooks` | `saveId?` | Playbooks do save (pesos + preferências) + qual está ativo |

**Trabalho salvo (shortlist & buscas)**
| Nome | Input | Descrição |
|---|---|---|
| `get_shortlist` | `saveId?` | Shortlist com fitScore, prioridade e notas |
| `add_to_shortlist` ✍️ | `sofifaId`, `priority?`, `notes?`, `saveId?` | Adiciona jogador à shortlist |
| `remove_from_shortlist` ✍️ | `sofifaId`, `saveId?` | Remove jogador da shortlist |
| `list_saved_searches` | `saveId?` | Buscas salvas (nome + filtros) |
| `run_saved_search` | `name`, `limit?`, `saveId?` | Roda uma busca salva → jogadores com scoutScore |
| `create_saved_search` ✍️ | `name`, `position?`, `maxAge?`, `minOverall?`, `minPotential?`, `maxMarketValue?`, `objective?`, `saveId?` | Salva uma busca reutilizável |

**Histórico & desenvolvimento**
| Nome | Input | Descrição |
|---|---|---|
| `get_player_development` | `name`, `saveId?` | Trajetória OVR/valor + stats por temporada (G/A/jogos/cartões/clean sheets) de um jogador do elenco |
| `list_transfers` | `currentSeasonOnly?`, `limit?`, `saveId?` | Histórico de transferências (compras/vendas/empréstimos) com fee e temporada |
| `list_loanees` | `saveId?` | Emprestados na temporada atual + desempenho no clube de empréstimo |
| `list_trophies` | `saveId?` | Títulos conquistados no save (competição + ano + clube) |

✍️ = ação de escrita (a persona confirma com o usuário antes de chamar).

**Formato de saída:** as tools devolvem **JSON ou texto estruturado em bullets** (sem tabelas
markdown), e o resource `save://{saveId}/dossier` é JSON (`application/json`) — o modelo lê
valores limpos e formata a resposta ao usuário conforme a persona, que proíbe ecoar JSON/tabela
cru na tela. O resource `playbook://{saveId}` segue em markdown (texto curto de pesos/prefs).
Valores monetários já vêm formatados (`"€45M"`, `"€2100K"`) para o modelo citar sem errar a
unidade.

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
    helpers.ts        — formatadores compartilhados (scoredPlayerLine, noSaveResult)
    saves.ts          — get_active_save_context, list_saves
    finances.ts       — get_finances
    scouting.ts       — find_player, identify_squad_gaps, search_transfer_targets, evaluate_signing_fit
    scout-intel.ts    — recommend_signings, plan_transfer_window, compare_players, get_club_archetype, list_scout_playbooks
    shortlist.ts      — get_shortlist, add_to_shortlist, remove_from_shortlist
    saved-searches.ts — list_saved_searches, run_saved_search, create_saved_search
    squad.ts          — analyze_squad_by_position, analyze_squad_needs
    performance.ts    — get_season_performance
    history.ts        — get_player_development, list_transfers, list_loanees, list_trophies
  resources/
    index.ts          — registerResources
    playbook.ts       — playbook://{saveId}
    dossier.ts        — save://{saveId}/dossier (wrapper p/ features/saves/dossier.service.ts)
  __tests__/
    auth.test.ts          — unit tests para resolveMcpContext
    integration.test.ts   — boot Fastify + tools/list + tools/call
```
