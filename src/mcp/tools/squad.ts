import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Position } from '@prisma/client'
import { z } from 'zod'
import { identifyGaps } from '../../features/scouting/scouting.service.js'
import { prisma } from '../../shared/lib/prisma.js'
import { formatMarketValue, formatSalary, millions, thousands } from '../../shared/utils/currency.js'
import type { McpContext } from '../context.js'
import { resolveSaveId } from '../utils.js'
import { noSaveResult, textResult } from './helpers.js'

const SECTORS: { label: string; positions: Position[] }[] = [
  { label: 'GK', positions: ['GOL'] },
  { label: 'DEF', positions: ['ZAG', 'LD', 'LE'] },
  { label: 'MID', positions: ['VOL', 'MC', 'ME', 'MD', 'MEI'] },
  { label: 'ATT', positions: ['PE', 'PD', 'SA', 'ATA'] },
]

const OBJECTIVE_LENS: Record<string, string> = {
  balanced: 'Balance current quality against squad age.',
  title: 'Title push — starters must be top-tier; low tolerance for OVR drop-off or an aging core.',
  youth: 'Youth project — value potential and young depth; veterans are sale candidates, not reinforcements.',
  rebuild: 'Rebuild — blend overall with potential within the ideal age band.',
}

type SquadPlayer = {
  name: string
  position: Position
  age: number
  ovr: number
  potential: number | null
  status: string
  salary: number | null
  marketValue: number | null
  shirtNumber: number | null
}

type LoadedSquad =
  | { ok: false; error: string }
  | { ok: true; club: string; players: SquadPlayer[] }

async function loadActiveSquad(userId: string, saveId: string): Promise<LoadedSquad> {
  const save = await prisma.save.findFirst({
    where: { id: saveId, userId },
    include: { clubStints: { where: { isCurrent: true }, take: 1 } },
  })
  if (!save) return { ok: false, error: 'Save not found.' }

  const stint = save.clubStints[0]
  if (!stint) return { ok: false, error: 'This save has no active club.' }

  const players = (await prisma.player.findMany({
    where: { saveId: save.id, activeClubStintId: stint.id },
    orderBy: [{ position: 'asc' }, { ovr: 'desc' }],
    select: {
      name: true,
      position: true,
      age: true,
      ovr: true,
      potential: true,
      status: true,
      salary: true,
      marketValue: true,
      shirtNumber: true,
    },
  })) as SquadPlayer[]

  return { ok: true, club: stint.club, players }
}

function avg(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
}

async function resolveObjective(saveId: string): Promise<string> {
  const playbook = await prisma.scoutPlaybook.findFirst({
    where: { saveId, isDefault: true },
    orderBy: { updatedAt: 'desc' },
    select: { preferences: true },
  })
  const objective = (playbook?.preferences as { objective?: string } | null)?.objective
  return objective ?? 'balanced'
}

export function registerSquadTools(server: McpServer, ctx: McpContext) {
  server.registerTool(
    'analyze_squad_by_position',
    {
      description:
        'Returns the full active-club roster grouped by sector (GK / DEF / MID / ATT) with name, age, OVR/potential, status, salary and market value, plus a per-sector summary (count, average OVR/age). Use for squad composition, depth, who they have, salaries or a roster overview. For "what do I need to sign" use analyze_squad_needs instead.',
      inputSchema: {
        saveId: z.string().optional().describe('Save ID. If omitted, uses the conversation/most recent save.'),
      },
    },
    async ({ saveId }) => {
      const id = await resolveSaveId(ctx.userId, saveId, ctx.saveId)
      if (!id) return noSaveResult

      const loaded = await loadActiveSquad(ctx.userId, id)
      if (!loaded.ok) return textResult(loaded.error)
      const { club, players } = loaded

      if (players.length === 0) return textResult(`No players in the active squad of ${club}.`)

      const out = [`Squad — ${club} (${players.length} players)`, '']

      for (const sector of SECTORS) {
        const inSector = players.filter((p) => sector.positions.includes(p.position))
        if (inSector.length === 0) continue

        const avgOvr = avg(inSector.map((p) => p.ovr))
        const avgAge = avg(inSector.map((p) => p.age))
        out.push(`${sector.label} (${inSector.length}) — avg OVR ${avgOvr?.toFixed(0) ?? '—'}, avg age ${avgAge?.toFixed(1) ?? '—'}`)
        for (const p of inSector) {
          out.push(
            `  • #${p.shirtNumber ?? '—'} ${p.name} (${p.position}) — ${p.age}y · OVR ${p.ovr}${p.potential != null ? `/POT ${p.potential}` : ''} · ${p.status} · ${formatSalary(thousands(p.salary))}/wk · ${formatMarketValue(millions(p.marketValue))}`,
          )
        }
        out.push('')
      }

      return textResult(out.join('\n'))
    },
  )

  server.registerTool(
    'analyze_squad_needs',
    {
      description:
        'PRIMARY tool for "what does my squad need". One call returns a needs analysis for the active club: per-sector depth and average OVR/age/potential, the formation gaps (count vs ideal, aging, weak), and the active playbook objective with a strategic lens. Use this before recommend_signings so the recommendation targets a real need. Cross-reference its output with get_club_archetype and recommend_signings.',
      inputSchema: {
        formation: z.enum(['4-3-3', '4-2-3-1']).optional().describe('Formation to evaluate depth against. Default 4-3-3.'),
        saveId: z.string().optional(),
      },
    },
    async ({ formation, saveId }) => {
      const id = await resolveSaveId(ctx.userId, saveId, ctx.saveId)
      if (!id) return noSaveResult

      const loaded = await loadActiveSquad(ctx.userId, id)
      if (!loaded.ok) return textResult(loaded.error)
      const { club, players } = loaded
      if (players.length === 0) return textResult(`No players in the active squad of ${club}.`)

      const [gaps, objective] = await Promise.all([
        identifyGaps(ctx.userId, id, { formation }).catch(() => []),
        resolveObjective(id),
      ])

      const squadAvgOvr = avg(players.map((p) => p.ovr))

      const out = [
        `Squad needs — ${club} · formation ${formation ?? '4-3-3'} · objective "${objective}"`,
        `Lens: ${OBJECTIVE_LENS[objective] ?? OBJECTIVE_LENS.balanced}`,
        `Squad-wide avg OVR ${squadAvgOvr?.toFixed(0) ?? '—'} across ${players.length} players.`,
        '',
      ]

      for (const sector of SECTORS) {
        const inSector = players.filter((p) => sector.positions.includes(p.position))
        const avgOvr = avg(inSector.map((p) => p.ovr))
        const avgAge = avg(inSector.map((p) => p.age))
        const avgPot = avg(inSector.map((p) => p.potential ?? p.ovr))
        const bestOvr = inSector.length ? Math.max(...inSector.map((p) => p.ovr)) : null
        const sectorGaps = gaps.filter((g) => sector.positions.includes(g.position))

        const tags: string[] = []
        if (sectorGaps.some((g) => g.severity === 'critical')) tags.push('THIN DEPTH')
        if (avgAge !== null && avgAge >= 30) tags.push('AGING')
        if (squadAvgOvr !== null && avgOvr !== null && avgOvr <= squadAvgOvr - 3) tags.push('QUALITY GAP')
        if ((objective === 'youth' || objective === 'rebuild') && avgPot !== null && bestOvr !== null && avgPot - bestOvr < 2) {
          tags.push('LOW UPSIDE')
        }

        out.push(
          `${sector.label} (${inSector.length}) — avg OVR ${avgOvr?.toFixed(0) ?? '—'}, avg age ${avgAge?.toFixed(1) ?? '—'}, best OVR ${bestOvr ?? '—'}${tags.length ? ` · ${tags.join(', ')}` : ' · ok'}`,
        )
        for (const g of sectorGaps) {
          out.push(`    gap: [${g.severity}] ${g.position} ${g.count}/${g.ideal} — ${g.reason}`)
        }
      }

      out.push('')
      out.push('Next: pick the most pressing sector, call get_club_archetype for its DNA, then recommend_signings to get scored targets.')

      return textResult(out.join('\n'))
    },
  )
}
