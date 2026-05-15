import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '../../shared/lib/prisma.js'
import type { McpContext } from '../context.js'
import { resolveSaveId } from '../utils.js'

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
      const id = await resolveSaveId(ctx.userId, saveId)
      if (!id) return { content: [{ type: 'text', text: 'Nenhum save encontrado.' }] }

      const save = await prisma.save.findFirst({
        where: { id, userId: ctx.userId },
        include: { clubStints: { where: { isCurrent: true }, take: 1 } },
      })
      if (!save) return { content: [{ type: 'text', text: 'Save não encontrado.' }] }

      const stint = save.clubStints[0]
      if (!stint) {
        return { content: [{ type: 'text', text: 'Esta save não tem um clube ativo.' }] }
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

      const out = [`# Temporada ${targetSeason} — ${stint.club}`, '']

      if (teamStats.length === 0) {
        out.push('_Sem estatísticas de equipe registradas para esta temporada._', '')
      } else {
        out.push('## Resultados por competição')
        out.push('')
        out.push('| Competição | V | E | D | GP | GC | Posição/Resultado |')
        out.push('|---|---|---|---|---|---|---|')
        for (const t of teamStats) {
          const competition = t.competition?.name ?? 'Geral'
          const result =
            t.competition?.type === 'League'
              ? t.leaguePosition !== null
                ? `${t.leaguePosition}º`
                : '—'
              : t.cupResult ?? '—'
          out.push(`| ${competition} | ${t.wins} | ${t.draws} | ${t.losses} | ${t.goalsPro} | ${t.goalsAgainst} | ${result} |`)
        }
        out.push('')
      }

      if (topScorers.length > 0) {
        out.push('## Top artilheiros')
        out.push('')
        out.push('| Jogador | Pos | J | G | A |')
        out.push('|---|---|---|---|---|')
        for (const s of topScorers) {
          out.push(`| ${s.player.name} | ${s.player.position} | ${s.matches} | ${s.goals} | ${s.assists} |`)
        }
        out.push('')
      }

      if (topAssisters.length > 0) {
        out.push('## Top assistentes')
        out.push('')
        out.push('| Jogador | Pos | J | A | G |')
        out.push('|---|---|---|---|---|')
        for (const a of topAssisters) {
          out.push(`| ${a.player.name} | ${a.player.position} | ${a.matches} | ${a.assists} | ${a.goals} |`)
        }
        out.push('')
      }

      if (teamStats.length === 0 && topScorers.length === 0 && topAssisters.length === 0) {
        return {
          content: [
            { type: 'text', text: `Nenhuma estatística registrada para a temporada ${targetSeason}.` },
          ],
        }
      }

      return { content: [{ type: 'text', text: out.join('\n') }] }
    },
  )
}
