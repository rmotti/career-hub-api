import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '../../shared/lib/prisma.js'
import { formatBalance, millions } from '../../shared/utils/currency.js'
import type { McpContext } from '../context.js'
import { jsonResult } from './helpers.js'

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
      const targetId = saveId ?? ctx.saveId
      const save = targetId
        ? await prisma.save.findFirst({
            where: { id: targetId, userId: ctx.userId },
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

      return jsonResult({
        saves: saves.map((s) => ({
          id: s.id,
          name: s.name,
          club: s.clubStints[0]?.club ?? null,
          season: s.currentSeason,
          lastPlayed: s.updatedAt.toISOString().slice(0, 10),
        })),
      })
    },
  )
}
