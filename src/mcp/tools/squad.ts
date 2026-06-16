import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Position } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../shared/lib/prisma.js'
import { formatSalary, thousands } from '../../shared/utils/currency.js'
import type { McpContext } from '../context.js'
import { resolveSaveId } from '../utils.js'

const SECTORS: { label: string; positions: Position[] }[] = [
  { label: 'GK', positions: ['GOL'] },
  { label: 'DEF', positions: ['ZAG', 'LD', 'LE'] },
  { label: 'MID', positions: ['VOL', 'MC', 'ME', 'MD', 'MEI'] },
  { label: 'ATT', positions: ['PE', 'PD', 'SA', 'ATA'] },
]

export function registerSquadTools(server: McpServer, ctx: McpContext) {
  server.registerTool(
    'analyze_squad_by_position',
    {
      description:
        'Returns the full active-club roster grouped by sector (GK / DEF / MID / ATT) with name, age, position, OVR, status and salary. Use when user asks about squad composition, who they have, depth at each sector, salaries, or squad overview.',
      inputSchema: {
        saveId: z.string().optional().describe('Save ID. If omitted, uses the most recent save.'),
      },
    },
    async ({ saveId }) => {
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

      const players = await prisma.player.findMany({
        where: { saveId: save.id, activeClubStintId: stint.id },
        orderBy: [{ position: 'asc' }, { ovr: 'desc' }],
        select: { name: true, position: true, age: true, ovr: true, status: true, salary: true, shirtNumber: true },
      })

      if (players.length === 0) {
        return { content: [{ type: 'text', text: `Nenhum jogador no elenco ativo de ${stint.club}.` }] }
      }

      const out = [`# Elenco — ${stint.club} (${players.length} jogadores)`, '']

      for (const sector of SECTORS) {
        const inSector = players.filter((p) => sector.positions.includes(p.position))
        if (inSector.length === 0) continue

        out.push(`## ${sector.label} (${inSector.length})`)
        out.push('')
        out.push('| # | Nome | Pos | Idade | OVR | Status | Salário |')
        out.push('|---|---|---|---|---|---|---|')
        for (const p of inSector) {
          out.push(
            `| ${p.shirtNumber ?? '—'} | ${p.name} | ${p.position} | ${p.age} | ${p.ovr} | ${p.status} | ${formatSalary(thousands(p.salary))} |`,
          )
        }
        out.push('')
      }

      return { content: [{ type: 'text', text: out.join('\n') }] }
    },
  )
}
