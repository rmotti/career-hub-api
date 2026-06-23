import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  evaluateScoutPlayers,
  listScoutPlaybooks,
  scorePlayersBySofifaId,
} from '../../features/scout-playbooks/scout-playbooks.service.js'
import { getClubArchetype, identifyGaps } from '../../features/scouting/scouting.service.js'
import { prisma } from '../../shared/lib/prisma.js'
import { formatBalance, formatSalary, millions, thousands } from '../../shared/utils/currency.js'
import { positionLabel, positionLabels } from '../../shared/utils/positions.js'
import type { McpContext } from '../context.js'
import { resolveSaveId } from '../utils.js'
import { noSaveResult, scoredPlayerLine, textResult, type ScoredPlayerLike } from './helpers.js'

/** Resolves a single name to its best dataset sofifaId match (highest OVR substring hit). */
async function resolveNameToSofifaId(name: string): Promise<number | null> {
  const q = name.trim()
  if (q.length < 2) return null
  const row = await prisma.fc26Player.findFirst({
    where: {
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { longName: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: { ovr: 'desc' },
    select: { sofifaId: true },
  })
  return row?.sofifaId ?? null
}

const POSITION = z.enum(['GOL', 'ZAG', 'LD', 'LE', 'VOL', 'MC', 'ME', 'MD', 'MEI', 'PE', 'PD', 'SA', 'ATA'])
const OBJECTIVE = z.enum(['balanced', 'title', 'youth', 'rebuild'])

export function registerScoutIntelTools(server: McpServer, ctx: McpContext) {
  server.registerTool(
    'recommend_signings',
    {
      description:
        'PRIMARY tool for "who should I sign". Returns dataset players ranked by the save\'s scoutScore — the calibrated value-for-money signal that combines the active playbook weights (overall, potential, age, historical fit, market value), the transfer budget and the club\'s historical DNA. This is the SAME score the Scout tab shows, so prefer it over search_transfer_targets for any recommendation. Each player carries scoutScore, fitScore and a sofifaId you can pass to evaluate_signing_fit or add_to_shortlist.',
      inputSchema: {
        position: POSITION.optional().describe('Filter to one position (FC26 code). Omit to scout all positions.'),
        maxAge: z.number().int().optional(),
        minOverall: z.number().int().optional(),
        minPotential: z.number().int().optional(),
        maxMarketValue: z.number().optional().describe('Hard cap in millions of €. Also used as the value gradient reference.'),
        objective: OBJECTIVE.optional().describe('Overrides the playbook objective for this query only.'),
        playbookId: z.string().optional().describe('Score with a specific playbook instead of the save default.'),
        limit: z.number().int().optional().describe('How many ranked players to return (default 12, max 25).'),
        saveId: z.string().optional(),
      },
    },
    async (opts) => {
      const id = await resolveSaveId(ctx.userId, opts.saveId, ctx.saveId)
      if (!id) return noSaveResult

      const limit = Math.min(Math.max(opts.limit ?? 12, 1), 25)
      const result = await evaluateScoutPlayers(
        {
          saveId: id,
          playbookId: opts.playbookId,
          filters: {
            positions: opts.position ? [opts.position] : undefined,
            maxAge: opts.maxAge,
            minOvr: opts.minOverall,
            minPotential: opts.minPotential,
            maxMarketValue: opts.maxMarketValue,
            objective: opts.objective,
            limit,
          },
        },
        ctx.userId,
      )

      const players = result.players as unknown as ScoredPlayerLike[]
      if (players.length === 0) {
        return textResult('No players matched those filters.')
      }

      const obj = result.playbook.preferences.objective ?? 'balanced'
      const header = `Recommended signings (top ${players.length} of ${result.total}) — playbook "${result.playbook.name}", objective "${obj}". Ranked by scoutScore (0–100, higher = better value for money for THIS club).`

      return textResult([header, '', ...players.map(scoredPlayerLine)].join('\n'))
    },
  )

  server.registerTool(
    'plan_transfer_window',
    {
      description:
        'Builds a coherent transfer-window plan in ONE call: takes the squad needs (by severity), and for each pressing need picks the best AFFORDABLE target by scoutScore, tracking the running cost against the transfer budget (greedy — each pick reduces the remaining budget for the next). Use for "plan my window", "what should I do this window", "build me a shopping list". Returns a need→target plan with the budget left over.',
      inputSchema: {
        formation: z.enum(['4-3-3', '4-2-3-1']).optional().describe('Formation to evaluate needs against. Default 4-3-3.'),
        maxTargets: z.number().int().optional().describe('How many needs to address (default 3, max 5).'),
        saveId: z.string().optional(),
      },
    },
    async ({ formation, maxTargets, saveId }) => {
      const id = await resolveSaveId(ctx.userId, saveId, ctx.saveId)
      if (!id) return noSaveResult

      const save = await prisma.save.findFirst({ where: { id, userId: ctx.userId }, select: { budget: true } })
      if (!save) return noSaveResult
      const budget = save.budget

      const gaps = await identifyGaps(ctx.userId, id, { formation }).catch(() => [])
      if (gaps.length === 0) {
        return textResult(`No gaps for formation ${formation ?? '4-3-3'} — no signings strictly needed this window.`)
      }

      const limit = Math.min(Math.max(maxTargets ?? 3, 1), 5)
      const needs = gaps.slice(0, limit) // identifyGaps is already severity-sorted

      let remaining = budget // null ⇒ budget unknown, costs not netted
      const used = new Set<number>()
      const lines: string[] = []

      for (const gap of needs) {
        const result = await evaluateScoutPlayers(
          {
            saveId: id,
            filters: {
              positions: [gap.position],
              ...(remaining != null ? { maxMarketValue: remaining } : {}),
              limit: 6,
            },
          },
          ctx.userId,
        )

        const players = result.players as unknown as ScoredPlayerLike[]
        const pick = players.find((p) => !used.has(p.sofifaId))

        if (!pick) {
          lines.push(`• ${positionLabel(gap.position)} [${gap.severity}] — no affordable target found (${gap.reason})`)
          continue
        }

        used.add(pick.sofifaId)
        const mv = pick.marketValue ?? null
        if (remaining != null && mv != null) remaining = Math.round((remaining - mv) * 10) / 10

        lines.push(
          `• ${positionLabel(gap.position)} [${gap.severity}] → ${pick.name} (${positionLabels(pick.positions)}) ${pick.age}y · OVR ${pick.ovr}/POT ${pick.potential} · ${formatBalance(millions(mv))} · ScoutScore ${pick.scoutScore ?? '—'} · Fit ${pick.fitScore ?? '—'} · sofifaId ${pick.sofifaId}`,
        )
      }

      const header = `Transfer window plan — budget ${formatBalance(millions(budget))}, addressing ${needs.length} need(s) by severity:`
      const footer =
        remaining != null
          ? `Budget left after this plan: ${formatBalance(millions(remaining))}.`
          : 'Transfer budget unknown — costs not netted against a budget.'

      return textResult([header, '', ...lines, '', footer].join('\n'))
    },
  )

  server.registerTool(
    'get_club_archetype',
    {
      description:
        'Club DNA for a position: the profile of players this club has historically signed — typical age (median, p25–p75), the most common nationalities and origin leagues, with a confidence level from the sample size. Use it to answer "what kind of <position> do we usually buy", to sanity-check whether a target fits the club identity, or to shape the filters before recommend_signings.',
      inputSchema: {
        position: POSITION.describe('FC26 position code (e.g. ATA, MEI, ZAG).'),
        objective: OBJECTIVE.optional(),
        includeRecentSignings: z.boolean().optional().describe('Also list the most recent real signings behind the profile.'),
        saveId: z.string().optional(),
      },
    },
    async (opts) => {
      const id = await resolveSaveId(ctx.userId, opts.saveId, ctx.saveId)
      if (!id) return noSaveResult

      const r = await getClubArchetype(
        ctx.userId,
        id,
        opts.position,
        opts.objective ?? 'balanced',
        opts.includeRecentSignings ?? false,
      )

      if (!r.available) {
        return textResult(`No historical archetype available for ${positionLabel(opts.position)}: ${r.reason}`)
      }

      const age = r.archetype.age
      const topCats = (items: Array<{ value: string; pct: number }>) =>
        items.length ? items.map((c) => `${c.value} ${(c.pct * 100).toFixed(0)}%`).join(', ') : '—'

      const lines = [
        `Club DNA — ${r.clubName}, ${r.positionGroup} (objective "${r.objective}")`,
        `Sample: ${r.profile_size} transfers · confidence ${r.confidence}`,
        `Typical age: ${age.median} (p25 ${age.p25} – p75 ${age.p75})`,
        `Top nationalities: ${topCats(r.archetype.nationality)}`,
        `Top origin leagues: ${topCats(r.archetype.origin_league)}`,
      ]

      if (r.transfers?.length) {
        lines.push('', 'Recent signings:')
        for (const t of r.transfers.slice(0, 8)) {
          lines.push(`• ${t.player_name ?? '—'} (${t.transfer_season ?? '—'}) from ${t.from_club_name ?? '—'}`)
        }
      }

      return textResult(lines.join('\n'))
    },
  )

  server.registerTool(
    'compare_players',
    {
      description:
        'Compares 2–4 players side by side for the active save: OVR, potential, age, market value, wage, club, plus scoutScore and fitScore from the save playbook. Pass sofifaIds (preferred — from find_player / recommend_signings) and/or names (resolved to the closest match). Use for "X or Y?", "compare A, B and C".',
      inputSchema: {
        sofifaIds: z.array(z.number().int()).optional().describe('Dataset sofifaIds (preferred).'),
        names: z.array(z.string()).optional().describe('Player names; each resolved to its closest dataset match.'),
        saveId: z.string().optional(),
      },
    },
    async ({ sofifaIds, names, saveId }) => {
      const id = await resolveSaveId(ctx.userId, saveId, ctx.saveId)
      if (!id) return noSaveResult

      const ids = [...(sofifaIds ?? [])]
      for (const n of names ?? []) {
        const resolved = await resolveNameToSofifaId(n)
        if (resolved !== null) ids.push(resolved)
      }
      const unique = [...new Set(ids)].slice(0, 4)
      if (unique.length < 2) {
        return textResult('Need at least 2 valid players to compare. Use find_player to resolve names to sofifaIds first.')
      }

      const result = await scorePlayersBySofifaId({ saveId: id, sofifaIds: unique }, ctx.userId)
      if (result.players.length < 2) {
        return textResult('Could not resolve at least 2 of those players in the dataset.')
      }

      const obj = result.playbook.preferences.objective ?? 'balanced'
      const header = `Comparison — scored with playbook "${result.playbook.name}" (objective "${obj}"):`
      return textResult(
        [header, '', ...result.players.map((p) => scoredPlayerLine(p as unknown as ScoredPlayerLike))].join('\n'),
      )
    },
  )

  server.registerTool(
    'list_scout_playbooks',
    {
      description:
        'Lists the save\'s scout playbooks (scoring weights + preferences: objective, max market value, max wage) plus the built-in default, flagging which one is active. Use it to reference the user\'s strategy before recommending, or when they ask which playbook is driving the scores.',
      inputSchema: { saveId: z.string().optional() },
    },
    async ({ saveId }) => {
      const id = await resolveSaveId(ctx.userId, saveId, ctx.saveId)
      if (!id) return noSaveResult

      const { defaultPlaybook, playbooks } = await listScoutPlaybooks(id, ctx.userId)

      const renderWeights = (w: Record<string, number>) =>
        Object.entries(w)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `${k} ${v}`)
          .join(', ')

      const renderPrefs = (p: { objective?: string; maxMarketValue?: number; maxWage?: number }) => {
        const bits = [`objective ${p.objective ?? 'balanced'}`]
        if (p.maxMarketValue !== undefined) bits.push(`maxValue ${formatBalance(millions(p.maxMarketValue))}`)
        if (p.maxWage !== undefined) bits.push(`maxWage ${formatSalary(thousands(p.maxWage))}/wk`)
        return bits.join(', ')
      }

      const lines: string[] = []
      if (playbooks.length === 0) {
        lines.push(`No custom playbooks. Active = built-in default "${defaultPlaybook.name}".`)
      } else {
        lines.push(`Playbooks (${playbooks.length}):`)
        for (const pb of playbooks) {
          const active = pb.isDefault ? ' [ACTIVE]' : ''
          lines.push(`• ${pb.name}${active} — weights: ${renderWeights(pb.weights)} · ${renderPrefs(pb.preferences)}`)
        }
        if (!playbooks.some((pb) => pb.isDefault)) {
          lines.push(`(No default set — recommend_signings falls back to built-in "${defaultPlaybook.name}".)`)
        }
      }

      return textResult(lines.join('\n'))
    },
  )
}
