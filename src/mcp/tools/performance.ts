import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '../../shared/lib/prisma.js'
import type { McpContext } from '../context.js'
import { resolveSaveId } from '../utils.js'
import { jsonResult, textResult } from './helpers.js'

export function registerPerformanceTools(server: McpServer, ctx: McpContext) {
  server.registerTool(
    'get_season_performance',
    {
      description:
        'Returns team season stats (league position, W/D/L, goals, cup results) and top 5 scorers + top 5 assisters for the chosen season. Default season is the save\'s current season. Use when user asks about how the team did, season summary, scorers, assists, results.',
      inputSchema: {
        saveId: z.string().optional().describe('Save ID. If omitted, uses the most recent save.'),
        season: z.string().optional().describe('Season string, e.g. "2026/27". Defaults to the save current season.'),
      },
    },
    async ({ saveId, season }) => {
      const id = await resolveSaveId(ctx.userId, saveId, ctx.saveId)
      if (!id) return textResult('No save found.')

      const save = await prisma.save.findFirst({
        where: { id, userId: ctx.userId },
        include: { clubStints: { where: { isCurrent: true }, take: 1 } },
      })
      if (!save) return textResult('Save not found.')

      const stint = save.clubStints[0]
      if (!stint) {
        return textResult('This save has no active club.')
      }

      const targetSeason = season ?? save.currentSeason

      const [teamStats, topScorers, topAssisters] = await Promise.all([
        prisma.teamSeasonStats.findMany({
          where: { clubStintId: stint.id, season: targetSeason },
          include: { competition: { select: { name: true, type: true } } },
        }),
        prisma.playerSeasonStats.findMany({
          where: { clubStintId: stint.id, season: targetSeason },
          orderBy: { goals: 'desc' },
          take: 5,
          include: { player: { select: { name: true, position: true } } },
        }),
        prisma.playerSeasonStats.findMany({
          where: { clubStintId: stint.id, season: targetSeason },
          orderBy: { assists: 'desc' },
          take: 5,
          include: { player: { select: { name: true, position: true } } },
        }),
      ])

      if (teamStats.length === 0 && topScorers.length === 0 && topAssisters.length === 0) {
        return textResult(`No stats recorded for season ${targetSeason}.`)
      }

      return jsonResult({
        season: targetSeason,
        club: stint.club,
        competitions: teamStats.map((t) => ({
          competition: t.competition?.name ?? 'Overall',
          type: t.competition?.type ?? null,
          wins: t.wins,
          draws: t.draws,
          losses: t.losses,
          goalsFor: t.goalsPro,
          goalsAgainst: t.goalsAgainst,
          result:
            t.competition?.type === 'League'
              ? t.leaguePosition !== null
                ? `${t.leaguePosition}º`
                : null
              : t.cupResult ?? null,
        })),
        topScorers: topScorers.map((s) => ({
          name: s.player.name,
          position: s.player.position,
          matches: s.matches,
          goals: s.goals,
          assists: s.assists,
        })),
        topAssisters: topAssisters.map((a) => ({
          name: a.player.name,
          position: a.player.position,
          matches: a.matches,
          assists: a.assists,
          goals: a.goals,
        })),
      })
    },
  )
}
