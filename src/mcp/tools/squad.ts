import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Position } from '@prisma/client'
import { z } from 'zod'
import { FORMATION_NAMES, getFormation, normalizeFormation } from '../../features/scouting/formations.js'
import { identifyGaps } from '../../features/scouting/scouting.service.js'
import { prisma } from '../../shared/lib/prisma.js'
import { formatMarketValue, formatSalary, millions, thousands } from '../../shared/utils/currency.js'
import { positionLabel } from '../../shared/utils/positions.js'
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
  alternativePosition: { positions?: Position[] } | null
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
      alternativePosition: true,
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
            `  • #${p.shirtNumber ?? '—'} ${p.name} (${positionLabel(p.position)}) — ${p.age}y · OVR ${p.ovr}${p.potential != null ? `/POT ${p.potential}` : ''} · ${p.status} · ${formatSalary(thousands(p.salary))}/wk · ${formatMarketValue(millions(p.marketValue))}`,
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
        formation: z
          .string()
          .optional()
          .describe('Formation to evaluate depth against, any separator ("3-4-2-1", "3421", "352"). Default 4-3-3. Three/five-at-the-back shapes have no full-backs and model wing-backs as LM/RM.'),
        saveId: z.string().optional(),
      },
    },
    async ({ formation: rawFormation, saveId }) => {
      const formation = normalizeFormation(rawFormation)
      if (rawFormation && !formation) {
        return textResult(`Unsupported formation "${rawFormation}". Supported: ${FORMATION_NAMES.join(', ')}.`)
      }
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

      // Squad "level" = the best player in the squad, NOT an average. The whole read is starter-first:
      // for each position the highest OVR is the presumed starter; depth/quality is judged off that
      // and the drop-off to the backup — never a positional average (a single veteran or a 60-OVR
      // youth would skew a mean and hide the real picture).
      const squadBestOvr = players.length ? Math.max(...players.map((p) => p.ovr)) : null

      const out = [
        `Squad needs — ${club} · formation ${formation ?? '4-3-3'} · objective "${objective}"`,
        `Lens: ${OBJECTIVE_LENS[objective] ?? OBJECTIVE_LENS.balanced}`,
        `Squad benchmark: best player OVR ${squadBestOvr ?? '—'} across ${players.length} players (starter = top OVR per position).`,
        '',
      ]

      // Options at a position = specialists (primary) + cover (players whose alternativePosition
      // lists it). Both count at full OVR; we tag cover so the read can say "no specialist, covered
      // by X" instead of flagging a phantom gap (e.g. an LM who also plays LB covers the LB slot).
      const formationPositions = new Set(Object.keys(getFormation(formation).positions) as Position[])

      type Option = { name: string; age: number; ovr: number; specialist: boolean }
      const optionsAt = (pos: Position): Option[] => {
        const opts: Option[] = []
        for (const p of players) {
          if (p.position === pos) opts.push({ name: p.name, age: p.age, ovr: p.ovr, specialist: true })
          else if (p.alternativePosition?.positions?.includes(pos))
            opts.push({ name: p.name, age: p.age, ovr: p.ovr, specialist: false })
        }
        return opts.sort((a, b) => b.ovr - a.ovr)
      }

      for (const sector of SECTORS) {
        const inSector = players.filter((p) => sector.positions.includes(p.position))
        out.push(`${sector.label} (${inSector.length})`)

        // Report per position the formation actually uses in this sector, starter-first, with cover.
        const sectorFormationPositions = sector.positions.filter((pos) => formationPositions.has(pos))
        for (const pos of sectorFormationPositions) {
          const ranked = optionsAt(pos)
          if (ranked.length === 0) continue // a true empty slot — surfaced as a gap below
          const starter = ranked[0]
          const bench = ranked[1] ?? null
          const starterTag = starter.specialist ? '' : ` — cover (no specialist ${positionLabel(pos)})`
          const benchStr = bench ? `, backup ${bench.ovr}${bench.specialist ? '' : ' (cover)'}` : ', no backup'
          out.push(
            `    ${positionLabel(pos)} (${ranked.length}) — starter ${starter.name} OVR ${starter.ovr}, ${starter.age}y${starterTag}${benchStr}`,
          )
        }

        // Gaps for this sector come from identifyGaps (already starter/bench-based, cover-aware).
        const sectorGaps = gaps.filter((g) => sector.positions.includes(g.position))
        for (const g of sectorGaps) {
          out.push(`    gap: [${g.severity}] ${positionLabel(g.position)} ${g.count}/${g.ideal} — ${g.reason}`)
        }
      }

      out.push('')
      out.push('Next: pick the most pressing position, call get_club_archetype for its DNA, then recommend_signings to get scored targets.')

      return textResult(out.join('\n'))
    },
  )
}
