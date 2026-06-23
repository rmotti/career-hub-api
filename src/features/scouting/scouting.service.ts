import type { Position, Prisma } from '@prisma/client'
import { prisma } from '../../shared/lib/prisma.js'
import { AppError, NotFoundError } from '../../shared/utils/errors.js'
import { listFc26Players } from '../fc26-players/fc26-players.service.js'
import { fetchFitScoreArchetype, type FitScoreArchetypeResult } from '../../shared/lib/fit-score-client.js'
import { toFitScoreClubName } from '../../shared/utils/fit-score-maps.js'
import { findLeagueByClub } from '../clubs/clubs.service.js'
import { cacheGet, cacheSet } from '../../shared/utils/cache.js'
import { assertSaveAccess } from '../../shared/utils/save-access.js'
import { getFormation } from './formations.js'

export type GapSeverity = 'critical' | 'moderate' | 'low'

export type Gap = {
  position: Position
  severity: GapSeverity
  count: number
  ideal: number
  min: number
  /** The presumed starter = highest OVR available at the position. Quality is judged off this, never an average. */
  starterOvr: number | null
  /** Age of that starter (not a positional average — avoids a single veteran dragging the read). */
  starterAge: number | null
  /** Second-highest OVR available at the position. A big starter→bench drop-off is a depth-quality gap. */
  benchOvr: number | null
  /**
   * True when the position has NO specialist (primary-position) player and is covered only by
   * players whose primary position is elsewhere (via alternativePosition). Not a gap on its own —
   * the bot should mention the cover rather than recommend a signing.
   */
  coveredBySecondaryOnly: boolean
  reason: string
}

/** A starter sitting this many OVR below the squad's best player reads as below the club's level. */
const STARTER_BELOW_SQUAD_THRESHOLD = 6
/** A second-choice this many OVR below the starter reads as a thin/weak bench at that position. */
const BENCH_DROPOFF_THRESHOLD = 6

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
    select: { position: true, age: true, ovr: true, alternativePosition: true },
  })

  // An option at a position is either a specialist (it's their primary position) or cover (a
  // secondary/alternative position). Both count at full OVR — a multi-position player plays the
  // role at his real level — but we track which so the read can say "covered by X, no specialist".
  type Option = { age: number; ovr: number; specialist: boolean }
  const byPosition = new Map<Position, Option[]>()
  const addOption = (pos: Position, opt: Option) => {
    if (!byPosition.has(pos)) byPosition.set(pos, [])
    byPosition.get(pos)!.push(opt)
  }
  for (const p of squad) {
    addOption(p.position, { age: p.age, ovr: p.ovr, specialist: true })
    const alt = (p.alternativePosition as { positions?: Position[] } | null)?.positions ?? []
    for (const altPos of alt) addOption(altPos, { age: p.age, ovr: p.ovr, specialist: false })
  }
  // Sort each position by OVR desc so [0] = starter, [1] = first backup (specialist or cover).
  for (const options of byPosition.values()) options.sort((a, b) => b.ovr - a.ovr)

  // Club level baseline = the best player in the whole squad. A position whose starter sits well
  // below this is a quality gap relative to the team, regardless of how the position averages out.
  const squadBestOvr = squad.length ? Math.max(...squad.map((p) => p.ovr)) : null

  const gaps: Gap[] = []

  for (const [pos, req] of Object.entries(formation.positions) as [Position, { ideal: number; min: number }][]) {
    const options = byPosition.get(pos) ?? []
    const count = options.length // specialists + secondary-position cover, all at full OVR
    const specialistCount = options.filter((o) => o.specialist).length
    const starter = options[0] ?? null // highest OVR available = presumed starter (may be cover)
    const starterOvr = starter?.ovr ?? null
    const starterAge = starter?.age ?? null
    const benchOvr = options[1]?.ovr ?? null // second-best = first backup
    // No dedicated player at all, but a player from another position can fill in. We don't treat
    // this as a gap (the cover exists) — the squad-needs tool mentions it instead of recommending.
    const coveredBySecondaryOnly = specialistCount === 0 && count > 0

    let severity: GapSeverity
    let reason: string

    const starterBelowSquad =
      starterOvr !== null && squadBestOvr !== null && squadBestOvr - starterOvr >= STARTER_BELOW_SQUAD_THRESHOLD
    const benchDropoff = starterOvr !== null && benchOvr !== null && starterOvr - benchOvr >= BENCH_DROPOFF_THRESHOLD

    if (count < req.min) {
      severity = 'critical'
      reason = `Só ${count} opção(ões) na posição ${pos}, mínimo é ${req.min}.`
    } else if (count < req.ideal) {
      severity = 'moderate'
      reason = `${count} opção(ões) na posição ${pos}, ideal é ${req.ideal}.`
    } else if (starterBelowSquad) {
      // Titular abaixo do nível do elenco: o melhor jogador da posição fica muito atrás do
      // melhor do time. Vale reforçar para subir o teto da posição.
      severity = 'moderate'
      reason = `Titular em ${pos} (OVR ${starterOvr}) está ${squadBestOvr! - starterOvr!} abaixo do melhor do elenco (${squadBestOvr}).`
    } else if (starterAge !== null && starterAge >= 31) {
      severity = 'moderate'
      reason = `Titular em ${pos} tem ${starterAge} anos — candidato a renovação.`
    } else if (benchDropoff) {
      // Banco fraco: o reserva imediato cai muito abaixo do titular. Exposto a lesão/rodízio.
      severity = 'low'
      reason = `Banco fraco em ${pos}: reserva (OVR ${benchOvr}) está ${starterOvr! - benchOvr!} abaixo do titular (${starterOvr}).`
    } else if (starterOvr !== null && starterOvr < 75) {
      severity = 'low'
      reason = `Titular em ${pos} tem só ${starterOvr} de overall.`
    } else {
      // Adequately staffed and good quality. If it's only covered by a non-specialist, the tool
      // will note that, but it's not a need — don't emit a gap.
      continue
    }

    gaps.push({ position: pos, severity, count, ideal: req.ideal, min: req.min, starterOvr, starterAge, benchOvr, coveredBySecondaryOnly, reason })
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
  alternatives: SigningAlternative[]
}

export type SigningAlternative = {
  sofifaId: number
  name: string
  position: string
  ovr: number
  potential: number
  age: number
  marketValue: number | null
  club: string | null
}

const ALTERNATIVES_LIMIT = 5

/**
 * Same-(primary-)position dataset players the club could sign instead, ranked by overall.
 * "Near the budget": capped at the budget when known, otherwise at the target's own market
 * value (so we never suggest a costlier player). The target itself is excluded. Pure dataset
 * query — no fit-score call, keeping this off the rate-limited/expensive path.
 */
async function findAlternatives(
  excludeSofifaId: number,
  position: Position,
  budget: number | null,
  targetValue: number | null,
): Promise<SigningAlternative[]> {
  const cap = budget ?? targetValue
  const where: Prisma.Fc26PlayerWhereInput = {
    sofifaId: { not: excludeSofifaId },
    positions: { has: position },
  }
  if (cap !== null) where.marketValue = { not: null, lte: cap }

  const rows = await prisma.fc26Player.findMany({
    where,
    orderBy: { ovr: 'desc' },
    take: ALTERNATIVES_LIMIT * 4, // over-fetch: filtered down to same PRIMARY position below
  })

  return rows
    .filter((p) => p.positions[0] === position)
    .slice(0, ALTERNATIVES_LIMIT)
    .map((p) => ({
      sofifaId: p.sofifaId,
      name: p.name,
      position: p.positions.join('/'),
      ovr: p.ovr,
      potential: p.potential,
      age: p.age,
      marketValue: p.marketValue,
      club: p.club,
    }))
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

  const alternatives = primaryPos
    ? await findAlternatives(sofifaId, primaryPos, budget, marketValue)
    : []

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
    alternatives,
  }
}

// Posição FC26 (PT) → bucket de posição do fit-score-svc. Hoje usamos 4 buckets amplos
// (GK / DEF / MID / ATT) em vez dos 13 grupos granulares: o dataset histórico é pequeno
// (mediana ~7 transferências por clube×posição granular), e agregar eleva a robustez do
// cohort (mediana ~9, perfis com n>=10 sobem de 21% p/ 48%). O fit-score-svc expõe AMBOS
// (granular + bucket), então voltar à granularidade = só remapear os valores aqui.
const POSITION_GROUP: Record<string, string> = {
  GOL: 'GK',
  ZAG: 'DEF', LD: 'DEF', LE: 'DEF',
  VOL: 'MID', MC: 'MID', MD: 'MID', ME: 'MID', MEI: 'MID',
  PD: 'ATT', PE: 'ATT', SA: 'ATT', ATA: 'ATT',
}

const ARCHETYPE_TTL = 60 * 60 * 24

export type ClubArchetypeResult =
  | { available: true; clubName: string; positionGroup: string; objective: string } & FitScoreArchetypeResult
  | { available: false; reason: string }

export async function getClubArchetype(
  userId: string,
  saveId: string,
  position: string,
  objective: string,
  includeTransfers = false,
): Promise<ClubArchetypeResult> {
  await assertSaveAccess(saveId, userId)

  const positionGroup = POSITION_GROUP[position.toUpperCase()]
  if (!positionGroup) throw new AppError(`Posição inválida: ${position}.`, 400)

  const stint = await prisma.clubStint.findFirst({
    where: { saveId, isCurrent: true },
    select: { club: true },
  })
  if (!stint) throw new AppError('Esta save não tem um clube ativo.', 400)

  const league = findLeagueByClub(stint.club)
  const fitClubName = toFitScoreClubName(stint.club, league)

  // Cache separado com/sem transfers — os transfers não devem poluir o cache do arquétipo base
  const cacheKey = `archetype:${fitClubName}:${positionGroup}:${objective}${includeTransfers ? ':transfers' : ''}`
  const cached = await cacheGet<FitScoreArchetypeResult>(cacheKey)
  const raw = cached ?? await fetchFitScoreArchetype(fitClubName, positionGroup, objective, 5, includeTransfers)

  if (!raw) {
    return { available: false, reason: 'Nenhum perfil histórico disponível para esse clube/posição.' }
  }

  if (!cached) await cacheSet(cacheKey, raw, ARCHETYPE_TTL)

  return { available: true, clubName: stint.club, positionGroup, objective, ...raw }
}
