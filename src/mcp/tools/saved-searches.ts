import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import {
  createSavedSearch,
  listSavedSearches,
} from '../../features/saved-searches/saved-searches.service.js'
import { evaluateScoutPlayers } from '../../features/scout-playbooks/scout-playbooks.service.js'
import type { Fc26PlayerFilters } from '../../features/fc26-players/fc26-players.service.js'
import type { McpContext } from '../context.js'
import { resolveSaveId } from '../utils.js'
import { noSaveResult, scoredPlayerLine, textResult, type ScoredPlayerLike } from './helpers.js'

const POSITION = z.enum(['GOL', 'ZAG', 'LD', 'LE', 'VOL', 'MC', 'ME', 'MD', 'MEI', 'PE', 'PD', 'SA', 'ATA'])
const OBJECTIVE = z.enum(['balanced', 'title', 'youth', 'rebuild'])

function summarizeFilters(filters: Record<string, unknown>): string {
  const entries = Object.entries(filters).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0))
  if (!entries.length) return 'no filters'
  return entries.map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('/') : v}`).join(', ')
}

export function registerSavedSearchTools(server: McpServer, ctx: McpContext) {
  server.registerTool(
    'list_saved_searches',
    {
      description:
        'Lists the scout searches the user saved for this save (name + filter criteria). Use to remind the user what they saved, or to pick one to run with run_saved_search.',
      inputSchema: { saveId: z.string().optional() },
    },
    async ({ saveId }) => {
      const id = await resolveSaveId(ctx.userId, saveId, ctx.saveId)
      if (!id) return noSaveResult

      const items = await listSavedSearches(id, ctx.userId)
      if (items.length === 0) return textResult('No saved searches for this save.')

      const lines = items.map((s) => `• "${s.name}" — ${summarizeFilters(s.filters as Record<string, unknown>)}`)
      return textResult([`Saved searches (${items.length}):`, '', ...lines].join('\n'))
    },
  )

  server.registerTool(
    'run_saved_search',
    {
      description:
        'Runs a saved search by name and returns the matching players RANKED BY scoutScore (same as recommend_signings), applying the saved filters against the save\'s active playbook. Use when the user says "run my <name> search" or wants fresh results for a search they saved.',
      inputSchema: {
        name: z.string().describe('The saved search name (case-insensitive).'),
        limit: z.number().int().optional().describe('How many ranked players to return (default 12, max 25).'),
        saveId: z.string().optional(),
      },
    },
    async ({ name, limit, saveId }) => {
      const id = await resolveSaveId(ctx.userId, saveId, ctx.saveId)
      if (!id) return noSaveResult

      const items = await listSavedSearches(id, ctx.userId)
      const match = items.find((s) => s.name.toLowerCase() === name.trim().toLowerCase())
      if (!match) {
        const names = items.map((s) => `"${s.name}"`).join(', ') || 'none'
        return textResult(`No saved search named "${name}". Available: ${names}.`)
      }

      const max = Math.min(Math.max(limit ?? 12, 1), 25)
      const filters = { ...(match.filters as Omit<Fc26PlayerFilters, 'saveId'>), limit: max }
      const result = await evaluateScoutPlayers({ saveId: id, filters }, ctx.userId)

      const players = result.players as unknown as ScoredPlayerLike[]
      if (players.length === 0) return textResult(`"${match.name}" matched no players right now.`)

      const obj = result.playbook.preferences.objective ?? 'balanced'
      const header = `"${match.name}" — top ${players.length} of ${result.total}, scored with playbook "${result.playbook.name}" (objective "${obj}").`
      return textResult([header, '', ...players.map(scoredPlayerLine)].join('\n'))
    },
  )

  server.registerTool(
    'create_saved_search',
    {
      description:
        'WRITE ACTION. Saves a reusable scout search under a name so the user can re-run it later. Confirm the name and criteria with the user before calling. Names are unique per save.',
      inputSchema: {
        name: z.string().max(80).describe('A short name for the saved search.'),
        position: POSITION.optional(),
        maxAge: z.number().int().optional(),
        minOverall: z.number().int().optional(),
        minPotential: z.number().int().optional(),
        maxMarketValue: z.number().optional().describe('Cap in millions of €.'),
        objective: OBJECTIVE.optional(),
        saveId: z.string().optional(),
      },
    },
    async ({ name, position, maxAge, minOverall, minPotential, maxMarketValue, objective, saveId }) => {
      const id = await resolveSaveId(ctx.userId, saveId, ctx.saveId)
      if (!id) return noSaveResult

      const filters: Record<string, unknown> = {}
      if (position) filters.positions = [position]
      if (maxAge !== undefined) filters.maxAge = maxAge
      if (minOverall !== undefined) filters.minOvr = minOverall
      if (minPotential !== undefined) filters.minPotential = minPotential
      if (maxMarketValue !== undefined) filters.maxMarketValue = maxMarketValue
      if (objective) filters.objective = objective

      try {
        const saved = await createSavedSearch(id, { name, filters }, ctx.userId)
        return textResult(`Saved search "${saved.name}" created — ${summarizeFilters(filters)}.`)
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return textResult(`A saved search named "${name}" already exists for this save.`)
        }
        throw err
      }
    },
  )
}
