import type { Position } from '@prisma/client'
import { prisma } from '../../shared/lib/prisma.js'
import { AppError, NotFoundError } from '../../shared/utils/errors.js'
import { listFc26Players } from '../fc26-players/fc26-players.service.js'
import { getFormation } from './formations.js'

export type GapSeverity = 'critical' | 'moderate' | 'low'

export type Gap = {
  position: Position
  severity: GapSeverity
  count: number
  ideal: number
  min: number
  avgAge: number | null
  avgOvr: number | null
  bestOvr: number | null
  reason: string
}

async function getActiveStint(userId: string, saveId: string) {
  const save = await prisma.save.findFirst({
    where: { id: saveId, userId },
    include: { clubStints: { where: { isCurrent: true }, take: 1 } },
  })
  if (!save) throw new NotFoundError('Save não encontrado.')
  const stint = save.clubStints[0]
  if (!stint) throw new AppError('Esta save não tem um clube ativo.', 400)
  return { save, stint }
}

export async function identifyGaps(
  userId: string,
  saveId: string,
  opts: { formation?: string } = {},
): Promise<Gap[]> {
  const { stint } = await getActiveStint(userId, saveId)
  const formation = getFormation(opts.formation)

  const squad = await prisma.player.findMany({
    where: { saveId, activeClubStintId: stint.id },
    select: { position: true, age: true, ovr: true },
  })

  const byPosition = new Map<Position, { ages: number[]; ovrs: number[] }>()
  for (const p of squad) {
    if (!byPosition.has(p.position)) byPosition.set(p.position, { ages: [], ovrs: [] })
    const bucket = byPosition.get(p.position)!
    bucket.ages.push(p.age)
    bucket.ovrs.push(p.ovr)
  }

  const gaps: Gap[] = []

  for (const [pos, req] of Object.entries(formation.positions) as [Position, { ideal: number; min: number }][]) {
    const bucket = byPosition.get(pos) ?? { ages: [], ovrs: [] }
    const count = bucket.ages.length
    const avgAge = count ? bucket.ages.reduce((a, b) => a + b, 0) / count : null
    const avgOvr = count ? bucket.ovrs.reduce((a, b) => a + b, 0) / count : null
    const bestOvr = count ? Math.max(...bucket.ovrs) : null

    let severity: GapSeverity
    let reason: string

    if (count < req.min) {
      severity = 'critical'
      reason = `Só ${count} jogador(es) na posição ${pos}, mínimo é ${req.min}.`
    } else if (count < req.ideal) {
      severity = 'moderate'
      reason = `${count} jogador(es) na posição ${pos}, ideal é ${req.ideal}.`
    } else if (avgAge !== null && avgAge >= 31) {
      severity = 'moderate'
      reason = `Idade média alta em ${pos}: ${avgAge.toFixed(1)} anos.`
    } else if (bestOvr !== null && bestOvr < 75) {
      severity = 'low'
      reason = `Melhor jogador em ${pos} tem só ${bestOvr} de overall.`
    } else {
      continue
    }

    gaps.push({ position: pos, severity, count, ideal: req.ideal, min: req.min, avgAge, avgOvr, bestOvr, reason })
  }

  const severityOrder: Record<GapSeverity, number> = { critical: 0, moderate: 1, low: 2 }
  gaps.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

  return gaps
}

export type TransferTargetOpts = {
  position: string
  maxAge?: number
  minOverall?: number
  maxValue?: number
  saveId?: string
}

export async function searchTransferTargets(_userId: string, opts: TransferTargetOpts) {
  const result = await listFc26Players({
    positions: [opts.position],
    maxAge: opts.maxAge,
    minOvr: opts.minOverall,
    maxMarketValue: opts.maxValue,
    limit: 20,
    saveId: opts.saveId,
  })
  return result
}

export type SigningEvaluation = {
  verdict: 'strong' | 'reasonable' | 'poor'
  player: {
    name: string
    position: string
    ovr: number
    potential: number
    age: number
    marketValue: number | null
    club: string | null
  }
  costAnalysis: {
    marketValue: number | null
    budget: number | null
    affordable: boolean
    pctOfBudget: number | null
  }
  fitAnalysis: {
    samePositionCount: number
    bestSquadOvr: number | null
    avgSquadAge: number | null
    ovrDelta: number | null
    ageDelta: number | null
    note: string
  }
  alternatives: never[]
}

export async function evaluateSigningFit(
  userId: string,
  saveId: string,
  sofifaId: number,
): Promise<SigningEvaluation> {
  const { save, stint } = await getActiveStint(userId, saveId)

  const fc26 = await prisma.fc26Player.findUnique({ where: { sofifaId } })
  if (!fc26) throw new NotFoundError('Jogador (sofifaId) não encontrado no dataset FC26.')

  const primaryPos = fc26.positions[0] as Position | undefined
  const squad = primaryPos
    ? await prisma.player.findMany({
        where: { saveId, activeClubStintId: stint.id, position: primaryPos },
        select: { age: true, ovr: true },
      })
    : []

  const bestSquadOvr = squad.length ? Math.max(...squad.map((p) => p.ovr)) : null
  const avgSquadAge = squad.length ? squad.reduce((a, b) => a + b.age, 0) / squad.length : null

  const marketValue = fc26.marketValue
  const budget = save.budget
  const affordable = budget !== null && marketValue !== null && marketValue <= budget
  const pctOfBudget = budget && marketValue ? (marketValue / budget) * 100 : null

  const ovrDelta = bestSquadOvr !== null ? fc26.ovr - bestSquadOvr : null
  const ageDelta = avgSquadAge !== null ? fc26.age - avgSquadAge : null

  let verdict: SigningEvaluation['verdict']
  let note: string
  if (!affordable) {
    verdict = 'poor'
    note = `Valor de mercado (${marketValue ?? '?'}) excede o orçamento (${budget ?? '?'}).`
  } else if (ovrDelta !== null && ovrDelta >= 3) {
    verdict = 'strong'
    note = `Upgrade claro: +${ovrDelta} de overall sobre o melhor da posição.`
  } else if (ovrDelta !== null && ovrDelta <= -3) {
    verdict = 'poor'
    note = `Downgrade: ${ovrDelta} de overall vs o melhor que você já tem.`
  } else {
    verdict = 'reasonable'
    note =
      ovrDelta === null
        ? 'Nenhum jogador na posição — qualquer reforço é válido.'
        : `Reforço lateral: delta de overall ${ovrDelta >= 0 ? '+' : ''}${ovrDelta}.`
  }

  return {
    verdict,
    player: {
      name: fc26.name,
      position: fc26.positions.join('/'),
      ovr: fc26.ovr,
      potential: fc26.potential,
      age: fc26.age,
      marketValue,
      club: fc26.club,
    },
    costAnalysis: { marketValue, budget, affordable, pctOfBudget },
    fitAnalysis: { samePositionCount: squad.length, bestSquadOvr, avgSquadAge, ovrDelta, ageDelta, note },
    alternatives: [],
  }
}
