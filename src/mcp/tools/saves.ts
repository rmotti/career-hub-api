import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '../../shared/lib/prisma.js'
import { formatBalance, millions } from '../../shared/utils/currency.js'
import type { McpContext } from '../context.js'

export function registerSavesTools(server: McpServer, ctx: McpContext) {
  server.registerTool(
    'get_active_save_context',
    {
      description:
        "Returns the user's currently active save with club, season, budget and balance. Use whenever you need context about what save the user is playing right now.",
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
        return {
          content: [{ type: 'text', text: 'Nenhum save encontrado para este usuário.' }],
        }
      }

      const club = save.clubStints[0]?.club ?? '—'
      const text = [
        `# Save ativo: ${save.name}`,
        ``,
        `- **ID:** ${save.id}`,
        `- **Clube atual:** ${club}`,
        `- **Temporada:** ${save.currentSeason} (ano ${save.currentYear})`,
        `- **Orçamento de transferências:** ${formatBalance(millions(save.budget))}`,
        `- **Saldo do clube:** ${formatBalance(millions(save.balance))}`,
        `- **Última atividade:** ${save.updatedAt.toISOString()}`,
      ].join('\n')

      return { content: [{ type: 'text', text }] }
    },
  )

  server.registerTool(
    'list_saves',
    {
      description: "Lists all saves owned by the user with last played date.",
      inputSchema: {},
    },
    async () => {
      const saves = await prisma.save.findMany({
        where: { userId: ctx.userId },
        orderBy: { updatedAt: 'desc' },
        include: { clubStints: { where: { isCurrent: true }, take: 1 } },
      })

      if (saves.length === 0) {
        return { content: [{ type: 'text', text: 'Nenhum save encontrado.' }] }
      }

      const rows = saves
        .map((s) => {
          const club = s.clubStints[0]?.club ?? '—'
          return `| ${s.name} | ${club} | ${s.currentSeason} | ${s.updatedAt.toISOString().slice(0, 10)} | ${s.id} |`
        })
        .join('\n')

      const text = [
        `# Saves do usuário (${saves.length})`,
        ``,
        `| Nome | Clube atual | Temporada | Última atividade | ID |`,
        `|---|---|---|---|---|`,
        rows,
      ].join('\n')

      return { content: [{ type: 'text', text }] }
    },
  )
}
