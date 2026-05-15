import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  evaluateSigningFit,
  identifyGaps,
  searchTransferTargets,
} from '../../features/scouting/scouting.service.js'
import { formatBalance } from '../../shared/utils/currency.js'
import type { McpContext } from '../context.js'

async function resolveSaveId(userId: string, given: string | undefined): Promise<string | null> {
  if (given) return given
  const { prisma } = await import('../../shared/lib/prisma.js')
  const save = await prisma.save.findFirst({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  })
  return save?.id ?? null
}

const severityEmoji = { critical: '🔴', moderate: '🟡', low: '🟢' }

export function registerScoutingTools(server: McpServer, ctx: McpContext) {
  server.registerTool(
    'identify_squad_gaps',
    {
      description:
        'Use when the user asks about squad weaknesses, missing positions, or wants signing recommendations. Returns gaps grouped by severity for the chosen formation.',
      inputSchema: {
        saveId: z.string().optional().describe('Save ID. If omitted, uses the most recent save.'),
        formation: z
          .enum(['4-3-3', '4-2-3-1'])
          .optional()
          .describe('Formation to evaluate against. Default: 4-3-3.'),
      },
    },
    async ({ saveId, formation }) => {
      const id = await resolveSaveId(ctx.userId, saveId)
      if (!id) return { content: [{ type: 'text', text: 'Nenhum save encontrado.' }] }

      const gaps = await identifyGaps(ctx.userId, id, { formation })

      if (gaps.length === 0) {
        return {
          content: [
            { type: 'text', text: `Nenhuma lacuna crítica no elenco para a formação ${formation ?? '4-3-3'}.` },
          ],
        }
      }

      const rows = gaps
        .map(
          (g) =>
            `| ${severityEmoji[g.severity]} ${g.severity} | ${g.position} | ${g.count}/${g.ideal} | ${
              g.avgAge?.toFixed(1) ?? '—'
            } | ${g.bestOvr ?? '—'} | ${g.reason} |`,
        )
        .join('\n')

      const text = [
        `# Lacunas no elenco — formação ${formation ?? '4-3-3'}`,
        ``,
        `| Severidade | Posição | Atual/Ideal | Idade média | Melhor OVR | Motivo |`,
        `|---|---|---|---|---|---|`,
        rows,
      ].join('\n')

      return { content: [{ type: 'text', text }] }
    },
  )

  server.registerTool(
    'search_transfer_targets',
    {
      description:
        'Use when user wants to find players to sign with specific criteria (position, max age, min overall, max market value). Returns up to 20 FC26 players ranked by overall.',
      inputSchema: {
        position: z.string().describe('Position code: GOL, ZAG, LD, LE, VOL, MC, ME, MD, MEI, PE, PD, SA, ATA.'),
        maxAge: z.number().int().optional(),
        minOverall: z.number().int().optional(),
        maxValue: z.number().optional().describe('Max market value in millions of €.'),
        saveId: z.string().optional().describe('If provided, enriches results with fit-score for that save.'),
      },
    },
    async (opts) => {
      const result = await searchTransferTargets(ctx.userId, opts)

      if (result.players.length === 0) {
        return { content: [{ type: 'text', text: 'Nenhum jogador encontrado com esses filtros.' }] }
      }

      const rows = result.players
        .map(
          (p) =>
            `| ${p.name} | ${p.positions.join('/')} | ${p.age} | ${p.ovr}/${p.potential} | ${formatBalance(
              p.marketValue,
            )} | ${p.club ?? '—'} | ${p.sofifaId} |`,
        )
        .join('\n')

      const text = [
        `# Alvos encontrados (${result.players.length} de ${result.total})`,
        ``,
        `| Nome | Posição | Idade | OVR/POT | Valor | Clube | sofifaId |`,
        `|---|---|---|---|---|---|---|`,
        rows,
      ].join('\n')

      return { content: [{ type: 'text', text }] }
    },
  )

  server.registerTool(
    'evaluate_signing_fit',
    {
      description:
        'Use when user is considering a specific player and wants analysis. Compares cost vs budget and overall vs current squad at that position. Pass sofifaId (from search_transfer_targets results).',
      inputSchema: {
        sofifaId: z.number().int().describe('Player sofifaId (from FC26 dataset).'),
        saveId: z.string().optional().describe('Save ID. If omitted, uses the most recent save.'),
      },
    },
    async ({ sofifaId, saveId }) => {
      const id = await resolveSaveId(ctx.userId, saveId)
      if (!id) return { content: [{ type: 'text', text: 'Nenhum save encontrado.' }] }

      const r = await evaluateSigningFit(ctx.userId, id, sofifaId)
      const verdictEmoji = { strong: '✅', reasonable: '🟡', poor: '🔴' }[r.verdict]

      const text = [
        `# Avaliação: ${r.player.name} (${r.player.position})`,
        ``,
        `**Veredito:** ${verdictEmoji} ${r.verdict.toUpperCase()}`,
        ``,
        `## Jogador`,
        `- OVR/POT: ${r.player.ovr}/${r.player.potential}`,
        `- Idade: ${r.player.age}`,
        `- Clube atual: ${r.player.club ?? '—'}`,
        `- Valor de mercado: ${formatBalance(r.player.marketValue)}`,
        ``,
        `## Custo`,
        `- Orçamento disponível: ${formatBalance(r.costAnalysis.budget)}`,
        `- Caberia no orçamento: ${r.costAnalysis.affordable ? 'sim' : 'não'}`,
        r.costAnalysis.pctOfBudget !== null
          ? `- % do orçamento: ${r.costAnalysis.pctOfBudget.toFixed(1)}%`
          : '',
        ``,
        `## Encaixe`,
        `- Jogadores na posição: ${r.fitAnalysis.samePositionCount}`,
        `- Melhor OVR atual: ${r.fitAnalysis.bestSquadOvr ?? '—'}`,
        `- Idade média atual: ${r.fitAnalysis.avgSquadAge?.toFixed(1) ?? '—'}`,
        `- ${r.fitAnalysis.note}`,
      ]
        .filter(Boolean)
        .join('\n')

      return { content: [{ type: 'text', text }] }
    },
  )
}
