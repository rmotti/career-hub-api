import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '../../shared/lib/prisma.js'
import { formatBalance, formatSalary } from '../../shared/utils/currency.js'
import type { McpContext } from '../context.js'

export function registerFinancesTools(server: McpServer, ctx: McpContext) {
  server.registerTool(
    'get_finances',
    {
      description:
        "Returns the financial snapshot of a save: transfer budget, club balance and total monthly wage bill (sum of active squad salaries). Use when the user asks about money, budget, salaries or wage bill.",
      inputSchema: {
        saveId: z
          .string()
          .optional()
          .describe('Specific save ID. If omitted, uses the most recently updated save.'),
      },
    },
    async ({ saveId }) => {
      const save = saveId
        ? await prisma.save.findFirst({
            where: { id: saveId, userId: ctx.userId },
            include: { clubStints: { where: { isCurrent: true }, take: 1 } },
          })
        : await prisma.save.findFirst({
            where: { userId: ctx.userId },
            orderBy: { updatedAt: 'desc' },
            include: { clubStints: { where: { isCurrent: true }, take: 1 } },
          })

      if (!save) {
        return { content: [{ type: 'text', text: 'Nenhum save encontrado.' }] }
      }

      const stint = save.clubStints[0]
      const wageAgg = stint
        ? await prisma.player.aggregate({
            where: { saveId: save.id, activeClubStintId: stint.id },
            _sum: { salary: true },
            _count: true,
          })
        : null

      const totalWageBill = wageAgg?._sum.salary ?? null
      const squadSize = wageAgg?._count ?? 0

      const text = [
        `# Finanças — ${save.name}`,
        ``,
        `**Clube atual:** ${stint?.club ?? '—'}  ·  **Temporada:** ${save.currentSeason}`,
        ``,
        `| Item | Valor |`,
        `|---|---|`,
        `| Orçamento de transferências | ${formatBalance(save.budget)} |`,
        `| Saldo do clube | ${formatBalance(save.balance)} |`,
        `| Folha salarial total (mensal) | ${formatSalary(totalWageBill)} |`,
        `| Jogadores no elenco | ${squadSize} |`,
      ].join('\n')

      return { content: [{ type: 'text', text }] }
    },
  )
}
