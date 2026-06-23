import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  evaluateSigningFit,
  identifyGaps,
  searchTransferTargets,
} from '../../features/scouting/scouting.service.js'
import { prisma } from '../../shared/lib/prisma.js'
import { formatBalance, millions } from '../../shared/utils/currency.js'
import { FORMATION_NAMES } from '../../features/scouting/formations.js'
import { positionLabel, positionLabels } from '../../shared/utils/positions.js'
import type { McpContext } from '../context.js'
import { resolveSaveId } from '../utils.js'
import { jsonResult, noSaveResult } from './helpers.js'

const POSITION = z.enum(['GOL', 'ZAG', 'LD', 'LE', 'VOL', 'MC', 'ME', 'MD', 'MEI', 'PE', 'PD', 'SA', 'ATA'])

export function registerScoutingTools(server: McpServer, ctx: McpContext) {
  server.registerTool(
    'find_player',
    {
      description:
        'Resolve a player NAME to their canonical FC26 dataset row(s): sofifaId, club, positions, OVR, market value. Use this FIRST whenever the user names a player and you do NOT already have their sofifaId — before evaluate_signing_fit, add_to_shortlist or remove_from_shortlist. Returns the closest matches ranked by overall. Never guess a sofifaId; if there are no matches, tell the user the player was not found.',
      inputSchema: {
        name: z.string().min(2).describe('Player name or partial name (e.g. "Saka", "De Bruyne").'),
        limit: z.number().int().optional().describe('Max matches to return (default 8, max 15).'),
      },
    },
    async ({ name, limit }) => {
      const query = name.trim()
      const take = Math.min(Math.max(limit ?? 8, 1), 15)

      const select = {
        sofifaId: true,
        name: true,
        longName: true,
        club: true,
        league: true,
        positions: true,
        age: true,
        ovr: true,
        potential: true,
        marketValue: true,
      } as const

      // Substring match on both name and full name. Fall back to the longest token (usually the
      // surname) when the full phrase finds nothing — handles "Kevin De Bruyne" vs "De Bruyne".
      let rows = await prisma.fc26Player.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { longName: { contains: query, mode: 'insensitive' } },
          ],
        },
        orderBy: { ovr: 'desc' },
        take,
        select,
      })

      if (rows.length === 0) {
        const token = query.split(/\s+/).sort((a, b) => b.length - a.length)[0]
        if (token && token.length >= 2 && token !== query) {
          rows = await prisma.fc26Player.findMany({
            where: {
              OR: [
                { name: { contains: token, mode: 'insensitive' } },
                { longName: { contains: token, mode: 'insensitive' } },
              ],
            },
            orderBy: { ovr: 'desc' },
            take,
            select,
          })
        }
      }

      return jsonResult({
        query,
        matches: rows.map((p) => ({
          name: p.name,
          longName: p.longName,
          sofifaId: p.sofifaId,
          club: p.club,
          league: p.league,
          positions: positionLabels(p.positions),
          age: p.age,
          ovr: p.ovr,
          potential: p.potential,
          marketValue: formatBalance(millions(p.marketValue)),
        })),
      })
    },
  )

  server.registerTool(
    'identify_squad_gaps',
    {
      description:
        'Use when the user asks about squad weaknesses, missing positions, or wants signing recommendations. Returns gaps grouped by severity for the chosen formation. For a richer needs read tied to the playbook objective, prefer analyze_squad_needs.',
      inputSchema: {
        saveId: z.string().optional().describe('Save ID. If omitted, uses the most recent save.'),
        formation: z
          .enum(FORMATION_NAMES)
          .optional()
          .describe('Formation to evaluate against. Default: 4-3-3.'),
      },
    },
    async ({ saveId, formation }) => {
      const id = await resolveSaveId(ctx.userId, saveId, ctx.saveId)
      if (!id) return noSaveResult

      const gaps = await identifyGaps(ctx.userId, id, { formation })

      return jsonResult({
        formation: formation ?? '4-3-3',
        gaps: gaps.map((g) => ({
          position: positionLabel(g.position),
          severity: g.severity,
          count: g.count,
          ideal: g.ideal,
          min: g.min,
          avgAge: g.avgAge,
          avgOvr: g.avgOvr,
          bestOvr: g.bestOvr,
          reason: g.reason,
        })),
      })
    },
  )

  server.registerTool(
    'search_transfer_targets',
    {
      description:
        'Use when user wants a plain filtered list of dataset players (position, max age, min overall, max market value), ranked by raw overall — no scoutScore. For an actual signing recommendation prefer recommend_signings. Returns up to 20 FC26 players.',
      inputSchema: {
        position: POSITION.describe('FC26 position code (GOL, ZAG, LD, LE, VOL, MC, ME, MD, MEI, PE, PD, SA, ATA).'),
        maxAge: z.number().int().optional(),
        minOverall: z.number().int().optional(),
        maxValue: z.number().optional().describe('Max market value in millions of €.'),
        saveId: z.string().optional().describe('If provided, enriches results with fit-score for that save.'),
      },
    },
    async (opts) => {
      const saveId = opts.saveId ?? ctx.saveId
      const result = await searchTransferTargets(ctx.userId, { ...opts, saveId })

      const players = result.players as Array<(typeof result.players)[number] & { fitScore?: number | null }>

      return jsonResult({
        total: result.total,
        returned: players.length,
        players: players.map((p) => ({
          name: p.name,
          positions: positionLabels(p.positions),
          age: p.age,
          ovr: p.ovr,
          potential: p.potential,
          marketValue: formatBalance(millions(p.marketValue)),
          club: p.club,
          fitScore: p.fitScore ?? null,
          sofifaId: p.sofifaId,
        })),
      })
    },
  )

  server.registerTool(
    'evaluate_signing_fit',
    {
      description:
        'Use when user is considering a specific player and wants analysis. Compares cost vs budget and overall vs current squad at that position, with real alternatives. Pass sofifaId (from recommend_signings / search_transfer_targets results).',
      inputSchema: {
        sofifaId: z.number().int().describe('Player sofifaId (from FC26 dataset).'),
        saveId: z.string().optional().describe('Save ID. If omitted, uses the most recent save.'),
      },
    },
    async ({ sofifaId, saveId }) => {
      const id = await resolveSaveId(ctx.userId, saveId, ctx.saveId)
      if (!id) return noSaveResult

      const r = await evaluateSigningFit(ctx.userId, id, sofifaId)

      return jsonResult({
        verdict: r.verdict,
        player: {
          name: r.player.name,
          position: positionLabels(r.player.position.split('/')),
          ovr: r.player.ovr,
          potential: r.player.potential,
          age: r.player.age,
          club: r.player.club,
          marketValue: formatBalance(millions(r.player.marketValue)),
        },
        cost: {
          budget: formatBalance(millions(r.costAnalysis.budget)),
          affordable: r.costAnalysis.affordable,
          pctOfBudget: r.costAnalysis.pctOfBudget,
        },
        fit: {
          samePositionCount: r.fitAnalysis.samePositionCount,
          bestSquadOvr: r.fitAnalysis.bestSquadOvr,
          avgSquadAge: r.fitAnalysis.avgSquadAge,
          ovrDelta: r.fitAnalysis.ovrDelta,
          ageDelta: r.fitAnalysis.ageDelta,
          note: r.fitAnalysis.note,
        },
        alternatives: r.alternatives.map((a) => ({
          name: a.name,
          position: positionLabels(a.position.split('/')),
          ovr: a.ovr,
          potential: a.potential,
          age: a.age,
          marketValue: formatBalance(millions(a.marketValue)),
          club: a.club,
          sofifaId: a.sofifaId,
        })),
      })
    },
  )
}
