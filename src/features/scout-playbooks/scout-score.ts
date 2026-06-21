import type { Fc26PlayerWithFitScore } from '../fc26-players/fc26-players.service.js'
import {
  DEFAULT_SCOUT_PLAYBOOK,
  SCOUT_FIT_OBJECTIVES,
  SCOUT_SCORE_COMPONENTS,
  ResolvedScoutPlaybook,
  ScoutFitObjective,
  ScoutPlaybookInput,
  ScoutPlaybookPreferences,
  ScoutPlaybookWeights,
  ScoutScoreBreakdownItem,
  ScoutScoreComponent,
  ScoutScoreResult,
} from './scout-playbooks.types.js'

const COMPONENT_LABEL: Record<ScoutScoreComponent, string> = {
  overall: 'Overall',
  age: 'Idade',
  historicalFit: 'Fit histórico',
  potential: 'Potencial',
  marketValue: 'Valor de mercado',
  wage: 'Salário',
}

// B-003 scoring calibration — fixed scales (not relative to the candidate list) so a score
// means the same thing in every search. See docs/04_Next_Steps/4.4 B-003.
const OVR_FLOOR = 50
const OVR_CEIL = 95
const POTENTIAL_UPSIDE_DELTA = 20

// Age decays from 100 at AGE_ANCHOR with an accelerating per-year penalty.
const AGE_ANCHOR = 16
const AGE_BANDS: Array<{ upTo: number; k: number }> = [
  { upTo: 20, k: 2 },
  { upTo: 25, k: 3 },
  { upTo: 33, k: 5 },
  { upTo: Infinity, k: 7 },
]

/**
 * Budget references for the cost components, resolved per evaluation by the service:
 * - `marketValueRef`: the playbook/filter cap, else the save's transfer budget.
 * - `wageRef`: the `maxWage` cap only (no domain wage budget) — absent ⇒ wage is unavailable.
 * A null/undefined/≤0 reference marks the matching cost component unavailable (it drops).
 */
export interface ScoutScoreContext {
  marketValueRef?: number | null
  wageRef?: number | null
}

export function resolveInlinePlaybook(playbook?: ScoutPlaybookInput | null): ResolvedScoutPlaybook {
  if (!playbook) return DEFAULT_SCOUT_PLAYBOOK

  return {
    id: null,
    name: playbook.name?.trim() || 'Playbook temporário',
    weights: normalizeWeights(playbook.weights),
    preferences: normalizePreferences(playbook.preferences),
  }
}

export function normalizeWeights(weights?: ScoutPlaybookWeights | null): ResolvedScoutPlaybook['weights'] {
  const normalized = { ...DEFAULT_SCOUT_PLAYBOOK.weights } as ResolvedScoutPlaybook['weights']
  const raw = isRecord(weights) ? weights : {}

  for (const key of SCOUT_SCORE_COMPONENTS) {
    const value = raw[key]
    if (value === undefined) continue
    normalized[key] = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
  }

  return normalized
}

export function normalizePreferences(preferences?: ScoutPlaybookPreferences | null): ScoutPlaybookPreferences {
  const raw = isRecord(preferences) ? preferences : {}
  const objective = typeof raw.objective === 'string' && SCOUT_FIT_OBJECTIVES.includes(raw.objective as ScoutFitObjective)
    ? raw.objective as ScoutPlaybookPreferences['objective']
    : DEFAULT_SCOUT_PLAYBOOK.preferences.objective

  const normalized: ScoutPlaybookPreferences = { objective }
  const maxMarketValue = normalizePositiveNumber(raw.maxMarketValue)
  const maxWage = normalizePositiveNumber(raw.maxWage)

  if (maxMarketValue !== undefined) normalized.maxMarketValue = maxMarketValue
  if (maxWage !== undefined) normalized.maxWage = maxWage

  return normalized
}

export function calculateScoutScore(
  player: Fc26PlayerWithFitScore,
  playbook: ResolvedScoutPlaybook,
  context: ScoutScoreContext = {}
): ScoutScoreResult {
  const breakdown = (Object.entries(playbook.weights) as Array<[ScoutScoreComponent, number]>)
    .filter(([, weight]) => weight > 0)
    .map(([key, weight]) => calculateComponent(player, key, weight, context))

  const available = breakdown.filter((item) => item.available && item.score !== null && item.weight > 0)
  const totalWeight = available.reduce((sum, item) => sum + item.weight, 0)

  if (totalWeight <= 0) {
    return {
      scoutScore: null,
      scoutScoreConfidence: null,
      scoutScoreBreakdown: breakdown,
    }
  }

  const scoutScore = available.reduce((sum, item) => {
    const weightedScore = item.score! * (item.weight / totalWeight)
    item.weightedScore = round(weightedScore)
    return sum + weightedScore
  }, 0)

  return {
    scoutScore: round(scoutScore),
    scoutScoreConfidence: inferScoreConfidence(breakdown),
    scoutScoreBreakdown: breakdown,
  }
}

function calculateComponent(
  player: Fc26PlayerWithFitScore,
  key: ScoutScoreComponent,
  weight: number,
  context: ScoutScoreContext
): ScoutScoreBreakdownItem {
  const base = {
    key,
    label: COMPONENT_LABEL[key],
    weight,
    weightedScore: null,
  }

  if (key === 'overall') {
    return { ...base, score: scoreLevel(player.ovr), value: player.ovr, available: true }
  }

  if (key === 'potential') {
    return { ...base, score: scorePotentialUpside(player.potential, player.ovr), value: player.potential, available: true }
  }

  if (key === 'age') {
    return { ...base, score: scoreAge(player.age), value: player.age, available: true }
  }

  if (key === 'historicalFit') {
    // No profile for this club/position ⇒ score 0 (not dropped), so the weight stays in the
    // denominator and rankings remain comparable across players (B-003 #3).
    if (typeof player.fitScore !== 'number' || !Number.isFinite(player.fitScore) || player.fitConfidence === 'none') {
      return {
        ...base,
        score: 0,
        value: null,
        available: true,
        confidence: player.fitConfidence,
        profileSize: player.fitProfileSize,
        reason: 'Sem perfil histórico disponível para clube/posição.',
      }
    }

    return {
      ...base,
      score: clampScore(player.fitScore * 100),
      value: round(player.fitScore * 100),
      available: true,
      confidence: player.fitConfidence,
      profileSize: player.fitProfileSize,
    }
  }

  if (key === 'marketValue') {
    if (typeof player.marketValue !== 'number' || !Number.isFinite(player.marketValue)) {
      return { ...base, score: null, value: null, available: false, reason: 'Valor de mercado indisponível.' }
    }
    const ref = context.marketValueRef
    if (typeof ref !== 'number' || !Number.isFinite(ref) || ref <= 0) {
      return { ...base, score: null, value: player.marketValue, available: false, reason: 'Sem orçamento de referência para valor de mercado.' }
    }
    return { ...base, score: scoreBudget(player.marketValue, ref), value: player.marketValue, available: true }
  }

  // wage — opt-in: only scored when a `maxWage` reference exists (B-003 #1).
  if (typeof player.wage !== 'number' || !Number.isFinite(player.wage)) {
    return { ...base, score: null, value: null, available: false, reason: 'Salário indisponível.' }
  }
  const wageRef = context.wageRef
  if (typeof wageRef !== 'number' || !Number.isFinite(wageRef) || wageRef <= 0) {
    return { ...base, score: null, value: player.wage, available: false, reason: 'Defina um salário máximo (maxWage) para avaliar o salário.' }
  }
  return { ...base, score: scoreBudget(player.wage, wageRef), value: player.wage, available: true }
}

// Overall: fixed linear map OVR 50→0, 95→100 (B-003 #5).
function scoreLevel(ovr: number): number {
  return clampScore(((ovr - OVR_FLOOR) / (OVR_CEIL - OVR_FLOOR)) * 100)
}

// Potential: upside = headroom (potential − ovr) over DELTA, clamped (B-003 #4).
function scorePotentialUpside(potential: number, ovr: number): number {
  return clampScore(((potential - ovr) / POTENTIAL_UPSIDE_DELTA) * 100)
}

// Age: 100 at AGE_ANCHOR, accelerating per-year penalty by band (B-003 #2).
function scoreAge(age: number): number {
  if (age <= AGE_ANCHOR) return 100
  let penalty = 0
  for (let a = AGE_ANCHOR + 1; a <= age; a++) {
    penalty += agePenaltyForYear(a)
  }
  return clampScore(100 - penalty)
}

function agePenaltyForYear(age: number): number {
  for (const band of AGE_BANDS) {
    if (age <= band.upTo) return band.k
  }
  return AGE_BANDS[AGE_BANDS.length - 1].k
}

// Budget-relative "headroom": cheaper = higher; at the reference = 0; free = 100 (B-003 #1).
function scoreBudget(value: number, reference: number): number {
  return clampScore(100 * (1 - value / reference))
}

function inferScoreConfidence(breakdown: ScoutScoreBreakdownItem[]): ScoutScoreResult['scoutScoreConfidence'] {
  const historical = breakdown.find((item) => item.key === 'historicalFit')
  if (!historical || historical.weight <= 0) return 'fallback'
  if (!historical.available) return 'fallback'
  if (historical.confidence === 'high' || historical.confidence === 'medium' || historical.confidence === 'low') {
    return historical.confidence
  }
  return 'fallback'
}

function clampScore(value: number): number {
  return round(Math.min(Math.max(value, 0), 100))
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizePositiveNumber(value: unknown): number | undefined {
  const number = normalizeNumber(value)
  return number !== undefined && number > 0 ? number : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
