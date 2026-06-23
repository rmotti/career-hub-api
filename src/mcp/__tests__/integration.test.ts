import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../auth.js', () => ({
  resolveMcpContext: vi.fn(async () => ({ userId: 'user-1', sessionToken: 'tok' })),
}))

vi.mock('../rate-limit.js', () => ({
  checkRateLimit: vi.fn(async () => ({ ok: true })),
}))

vi.mock('../../shared/lib/prisma.js', () => ({
  prisma: {
    save: { findFirst: vi.fn() },
    player: { findMany: vi.fn(), aggregate: vi.fn() },
    fc26Player: { findUnique: vi.fn() },
    teamSeasonStats: { findMany: vi.fn() },
    playerSeasonStats: { findMany: vi.fn() },
    scoutPlaybook: { findFirst: vi.fn() },
  },
}))

import { mcpPlugin } from '../plugin.js'
import { prisma } from '../../shared/lib/prisma.js'

const mockedPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

function parseSseJson(body: string): unknown {
  const dataLine = body.split('\n').find((l) => l.startsWith('data:'))
  if (!dataLine) throw new Error(`no data line in SSE body: ${body}`)
  return JSON.parse(dataLine.slice(5).trim())
}

async function mcpCall(app: FastifyInstance, body: unknown) {
  return app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer fake',
    },
    payload: body,
  })
}

describe('mcp plugin integration', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    Object.values(mockedPrisma).forEach((m) => Object.values(m).forEach((fn) => fn.mockReset()))
    app = Fastify({ logger: false })
    await app.register(mcpPlugin)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('responds to initialize with serverInfo and capabilities', async () => {
    const res = await mcpCall(app, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    })

    expect(res.statusCode).toBe(200)
    const parsed = parseSseJson(res.body) as { result: { serverInfo: { name: string }; capabilities: object } }
    expect(parsed.result.serverInfo.name).toBe('career-hub')
    expect(parsed.result.capabilities).toHaveProperty('tools')
  })

  it('lists registered tools via tools/list', async () => {
    const res = await mcpCall(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(res.statusCode).toBe(200)
    const parsed = parseSseJson(res.body) as { result: { tools: { name: string }[] } }
    const names = parsed.result.tools.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'get_active_save_context',
        'list_saves',
        'get_finances',
        'identify_squad_gaps',
        'search_transfer_targets',
        'evaluate_signing_fit',
        'find_player',
        'analyze_squad_by_position',
        'analyze_squad_needs',
        'get_season_performance',
        'recommend_signings',
        'plan_transfer_window',
        'compare_players',
        'get_club_archetype',
        'list_scout_playbooks',
        'get_shortlist',
        'add_to_shortlist',
        'remove_from_shortlist',
        'list_saved_searches',
        'run_saved_search',
        'create_saved_search',
        'get_player_development',
        'list_transfers',
        'list_loanees',
        'list_trophies',
      ]),
    )
  })

  it('calls get_active_save_context and returns formatted markdown', async () => {
    mockedPrisma.save.findFirst.mockResolvedValue({
      id: 's1',
      name: 'Carreira 01',
      currentSeason: '2031/32',
      currentYear: 2031,
      budget: 100,
      balance: 50,
      updatedAt: new Date('2026-05-15T10:00:00Z'),
      clubStints: [{ club: 'Manchester City' }],
    })

    const res = await mcpCall(app, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_active_save_context', arguments: {} },
    })

    expect(res.statusCode).toBe(200)
    const parsed = parseSseJson(res.body) as { result: { content: { type: string; text: string }[] } }
    const text = parsed.result.content[0].text
    expect(text).toContain('Carreira 01')
    expect(text).toContain('Manchester City')
    expect(text).toContain('€100M')
  })
})
