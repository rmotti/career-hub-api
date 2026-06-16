import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { prisma } from '../../shared/lib/prisma.js'
import { cacheGet, cacheSet } from '../../shared/utils/cache.js'
import { formatBalance, formatSalary, millions, thousands } from '../../shared/utils/currency.js'
import { identifyGaps } from '../../features/scouting/scouting.service.js'
import type { McpContext } from '../context.js'

const TTL = 300

export function registerDossierResource(server: McpServer, ctx: McpContext) {
  server.registerResource(
    'save-dossier',
    new ResourceTemplate('save://{saveId}/dossier', { list: undefined }),
    {
      title: 'Save dossier',
      description:
        'Dense markdown briefing for a save: club, season, finances, top 5 players, identified squad gaps, last season results. Attach at the start of a conversation.',
      mimeType: 'text/markdown',
    },
    async (uri, variables) => {
      const saveIdRaw = variables.saveId
      const saveId = Array.isArray(saveIdRaw) ? saveIdRaw[0] : saveIdRaw
      if (!saveId) throw new Error('saveId ausente no URI save://{saveId}/dossier.')

      const cacheKey = `mcp:resource:dossier:${ctx.userId}:${saveId}`
      const cached = await cacheGet<string>(cacheKey)
      if (cached) {
        return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: cached }] }
      }

      const save = await prisma.save.findFirst({
        where: { id: saveId, userId: ctx.userId },
        include: { clubStints: { where: { isCurrent: true }, take: 1 } },
      })
      if (!save) throw new Error('Save não encontrado ou sem permissão.')

      const stint = save.clubStints[0]

      const [topPlayers, wageAgg, lastTeamStats, gaps] = await Promise.all([
        stint
          ? prisma.player.findMany({
              where: { saveId: save.id, activeClubStintId: stint.id },
              orderBy: { ovr: 'desc' },
              take: 5,
              select: { name: true, position: true, age: true, ovr: true, potential: true, status: true },
            })
          : Promise.resolve([]),
        stint
          ? prisma.player.aggregate({
              where: { saveId: save.id, activeClubStintId: stint.id },
              _sum: { salary: true },
              _count: true,
            })
          : Promise.resolve(null),
        stint
          ? prisma.teamSeasonStats.findMany({
              where: { clubStintId: stint.id, season: save.currentSeason },
              include: { competition: { select: { name: true, type: true } } },
            })
          : Promise.resolve([]),
        stint
          ? identifyGaps(ctx.userId, save.id, { formation: '4-3-3' }).catch(() => [])
          : Promise.resolve([]),
      ])

      const out: string[] = []
      out.push(`# Dossiê — ${save.name}`)
      out.push('')
      out.push(`**Clube:** ${stint?.club ?? '—'}  ·  **Temporada:** ${save.currentSeason} (ano ${save.currentYear})`)
      out.push('')
      out.push('## Finanças')
      out.push(`- Orçamento de transferências: ${formatBalance(millions(save.budget))}`)
      out.push(`- Saldo do clube: ${formatBalance(millions(save.balance))}`)
      out.push(`- Folha salarial total: ${formatSalary(thousands(wageAgg?._sum.salary ?? null))}`)
      out.push(`- Elenco: ${wageAgg?._count ?? 0} jogadores`)
      out.push('')

      if (topPlayers.length > 0) {
        out.push('## Top 5 do elenco')
        out.push('')
        out.push('| Nome | Pos | Idade | OVR/POT | Status |')
        out.push('|---|---|---|---|---|')
        for (const p of topPlayers) {
          out.push(`| ${p.name} | ${p.position} | ${p.age} | ${p.ovr}/${p.potential ?? '—'} | ${p.status} |`)
        }
        out.push('')
      }

      if (gaps.length > 0) {
        out.push('## Lacunas no elenco (formação 4-3-3)')
        out.push('')
        for (const g of gaps) {
          out.push(`- **${g.severity.toUpperCase()}** ${g.position}: ${g.reason}`)
        }
        out.push('')
      }

      if (lastTeamStats.length > 0) {
        out.push(`## Temporada atual — ${save.currentSeason}`)
        out.push('')
        out.push('| Competição | V | E | D | GP | GC | Posição/Resultado |')
        out.push('|---|---|---|---|---|---|---|')
        for (const t of lastTeamStats) {
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

      const text = out.join('\n')
      await cacheSet(cacheKey, text, TTL)
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] }
    },
  )
}
