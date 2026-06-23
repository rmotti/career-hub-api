import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { listTransfers } from '../../features/transfers/transfers.service.js'
import { listTrophies } from '../../features/trophies/trophies.service.js'
import { prisma } from '../../shared/lib/prisma.js'
import { assertSaveAccess } from '../../shared/utils/save-access.js'
import { formatMarketValue, millions } from '../../shared/utils/currency.js'
import { positionLabel } from '../../shared/utils/positions.js'
import type { McpContext } from '../context.js'
import { resolveSaveId } from '../utils.js'
import { jsonResult, noSaveResult, textResult } from './helpers.js'

interface TransferRow {
  playerName: string
  type: string
  from: string
  to: string
  season: string
  feeFormatted: string
}

export function registerHistoryTools(server: McpServer, ctx: McpContext) {
  server.registerTool(
    'get_player_development',
    {
      description:
        "Returns a squad player's development over seasons: OVR/market-value trajectory and per-season stats (goals, assists, matches, cards, clean sheets). Use for \"is <player> improving\", \"how's <player>'s season\", or to judge a youngster's growth. Resolves the player by name within the active save.",
      inputSchema: {
        name: z.string().min(2).describe('Squad player name (or partial).'),
        saveId: z.string().optional(),
      },
    },
    async ({ name, saveId }) => {
      const id = await resolveSaveId(ctx.userId, saveId, ctx.saveId)
      if (!id) return noSaveResult
      await assertSaveAccess(id, ctx.userId)

      const matches = await prisma.player.findMany({
        where: { saveId: id, name: { contains: name.trim(), mode: 'insensitive' } },
        orderBy: { ovr: 'desc' },
        select: { id: true, name: true, position: true, age: true, ovr: true, potential: true, status: true },
      })

      if (matches.length === 0) return textResult(`No squad player matching "${name}" in this save.`)

      const player = matches[0]
      const [ovrHistory, seasonStats] = await Promise.all([
        prisma.playerOvrHistory.findMany({
          where: { playerId: player.id },
          orderBy: { season: 'asc' },
          select: { season: true, ovr: true, marketValue: true },
        }),
        prisma.playerSeasonStats.findMany({
          where: { playerId: player.id },
          orderBy: { season: 'asc' },
          select: {
            season: true,
            goals: true,
            assists: true,
            matches: true,
            yellowCards: true,
            redCards: true,
            cleanSheets: true,
          },
        }),
      ])

      return jsonResult({
        player: {
          name: player.name,
          position: positionLabel(player.position),
          age: player.age,
          ovr: player.ovr,
          potential: player.potential,
          status: player.status,
        },
        otherMatches: matches.slice(1).map((m) => m.name),
        ovrHistory: ovrHistory.map((h) => ({
          season: h.season,
          ovr: h.ovr,
          marketValue: formatMarketValue(millions(h.marketValue)),
        })),
        seasonStats,
      })
    },
  )

  server.registerTool(
    'list_transfers',
    {
      description:
        'Lists the save\'s transfer history (signings, sales, loans) with player, type, from/to club, season and fee. Use for "who did I sell/sign", "what did I pay for <player>", window recaps.',
      inputSchema: {
        currentSeasonOnly: z.boolean().optional().describe('Only this season\'s transfers for the active club.'),
        limit: z.number().int().optional().describe('Max rows (default 25, max 50).'),
        saveId: z.string().optional(),
      },
    },
    async ({ currentSeasonOnly, limit, saveId }) => {
      const id = await resolveSaveId(ctx.userId, saveId, ctx.saveId)
      if (!id) return noSaveResult
      await assertSaveAccess(id, ctx.userId)

      const rows = (await listTransfers(id, currentSeasonOnly ? 'current' : undefined)) as TransferRow[]
      const take = Math.min(Math.max(limit ?? 25, 1), 50)

      return jsonResult({
        total: rows.length,
        transfers: rows.slice(0, take).map((t) => ({
          player: t.playerName,
          type: t.type,
          from: t.from,
          to: t.to,
          season: t.season,
          fee: t.feeFormatted,
        })),
      })
    },
  )

  server.registerTool(
    'list_loanees',
    {
      description:
        "Lists players currently out on loan from the save (this season) and how they're performing at the loan club: goals, assists, matches. Use for \"who's out on loan\", \"how are my loanees doing\".",
      inputSchema: { saveId: z.string().optional() },
    },
    async ({ saveId }) => {
      const id = await resolveSaveId(ctx.userId, saveId, ctx.saveId)
      if (!id) return noSaveResult
      await assertSaveAccess(id, ctx.userId)

      const save = await prisma.save.findUnique({ where: { id }, select: { currentSeason: true } })
      if (!save) return noSaveResult

      const spells = await prisma.loanSpellStats.findMany({
        where: { saveId: id, season: save.currentSeason },
        include: { player: { select: { name: true, position: true, ovr: true, age: true } } },
        orderBy: { matches: 'desc' },
      })

      if (spells.length === 0) return textResult(`No tracked loan spells this season (${save.currentSeason}).`)

      return jsonResult({
        season: save.currentSeason,
        loanees: spells.map((s) => ({
          name: s.player.name,
          position: positionLabel(s.player.position),
          ovr: s.player.ovr,
          age: s.player.age,
          loanClub: s.loanClub,
          matches: s.matches,
          goals: s.goals,
          assists: s.assists,
        })),
      })
    },
  )

  server.registerTool(
    'list_trophies',
    {
      description:
        'Lists the trophies won across the save (competition + year + club). Use for "what have I won", honours/palmarès questions.',
      inputSchema: { saveId: z.string().optional() },
    },
    async ({ saveId }) => {
      const id = await resolveSaveId(ctx.userId, saveId, ctx.saveId)
      if (!id) return noSaveResult
      await assertSaveAccess(id, ctx.userId)

      const trophies = (await listTrophies(id)) as Array<{
        year: number
        club: string
        competition: { name: string; type: string } | null
      }>

      if (trophies.length === 0) return textResult('No trophies recorded for this save yet.')

      return jsonResult({
        total: trophies.length,
        trophies: trophies.map((t) => ({
          competition: t.competition?.name ?? 'Unknown',
          type: t.competition?.type ?? null,
          year: t.year,
          club: t.club,
        })),
      })
    },
  )
}
