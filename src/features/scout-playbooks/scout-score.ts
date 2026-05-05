import type { Fc26PlayerWithFitScore } from '../fc26-players/fc26-players.service.js'
import {
  DEFAULT_SCOUT_PLAYBOOK,
  SCOUT_FIT_OBJECTIVES,
  SCOUT_SCORE_COMPONENTS,
  ResolvedScoutPlaybook,
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

const DEFAULT_OBJECTIVE_AGE_RANGE: Record<string, { min: number; max: number }> = {
  balanced: { min: 21, max: 29 },
  title: { min: 24, max: 31 },
  youth: { min: 16, max: 23 },
  rebuild: { min: 18, max: 25 },
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
  const idealAgeMin = normalizeNumber(raw.idealAgeMin)
  const idealAgeMax = normalizeNumber(raw.idealAgeMax)
  const maxMarketValue = normalizePositiveNumber(raw.maxMarketValue)
  const maxWage = normalizePositiveNumber(raw.maxWage)

  if (idealAgeMin !== undefined) normalized.idealAgeMin = clamp(idealAgeMin, 15, 45)
  if (idealAgeMax !== undefined) normalized.idealAgeMax = clamp(idealAgeMax, 15, 45)
  if (normalized.idealAgeMin !== undefined && normalized.idealAgeMax !== undefined && normalized.idealAgeMin > normalized.idealAgeMax) {
    const min = normalized.idealAgeMax
    normalized.idealAgeMax = normalized.idealAgeMin
    normalized.idealAgeMin = min
  }
  if (maxMarketValue !== undefined) normalized.maxMarketValue = maxMarketValue
  if (maxWage !== undefined) normalized.maxWage = maxWage

  return normalized
}

export function calculateScoutScore(
  player: Fc26PlayerWithFitScore,
  playbook: ResolvedScoutPlaybook
): ScoutScoreResult {
  const breakdown = (Object.entries(playbook.weights) as Array<[ScoutScoreComponent, number]>)
    .filter(([, weight]) => weight > 0)
    .map(([key, weight]) => calculateComponent(player, key, weight, playbook.preferences))

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
  preferences: ScoutPlaybookPreferences
): ScoutScoreBreakdownItem {
  const base = {
    key,
    label: COMPONENT_LABEL[key],
    weight,
    weightedScore: null,
  }

  if (key === 'overall') {
    return { ...base, score: clampScore(player.ovr), value: player.ovr, available: true }
  }

  if (key === 'potential') {
    return { ...base, score: clampScore(player.potential), value: player.potential, available: true }
  }

  if (key === 'age') {
    return { ...base, score: scoreAge(player.age, preferences), value: player.age, available: true }
  }

  if (key === 'historicalFit') {
    if (typeof player.fitScore !== 'number' || !Number.isFinite(player.fitScore) || player.fitConfidence === 'none') {
      return {
        ...base,
        score: null,
        value: null,
        available: false,
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

    return {
      ...base,
      score: scoreBudget(player.marketValue, preferences.maxMarketValue),
      value: player.marketValue,
      available: true,
    }
  }

  if (typeof player.wage !== 'number' || !Number.isFinite(player.wage)) {
    return { ...base, score: null, value: null, available: false, reason: 'Salário indisponível.' }
  }

  return {
    ...base,
    score: scoreBudget(player.wage, preferences.maxWage),
    value: player.wage,
    available: true,
  }
}

function scoreAge(age: number, preferences: ScoutPlaybookPreferences): number {
  const objective = preferences.objective ?? DEFAULT_SCOUT_PLAYBOOK.preferences.objective ?? 'balanced'
  const defaults = DEFAULT_OBJECTIVE_AGE_RANGE[objective] ?? DEFAULT_OBJECTIVE_AGE_RANGE.balanced
  const min = preferences.idealAgeMin ?? defaults.min
  const max = preferences.idealAgeMax ?? defaults.max

  if (age >= min && age <= max) return 100

  const distance = age < min ? min - age : age - max
  return clampScore(100 - (distance * 8))
}

function scoreBudget(value: number, maxValue?: number): number {
  if (typeof maxValue === 'number' && Number.isFinite(maxValue) && maxValue > 0) {
    if (value <= maxValue) return 100
    return clampScore(100 - (((value - maxValue) / maxValue) * 100))
  }

  return clampScore(100 - (Math.log10(Math.max(value, 0) + 1) * 22))
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
