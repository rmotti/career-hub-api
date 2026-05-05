export type ScoutScoreComponent =
  | 'overall'
  | 'age'
  | 'historicalFit'
  | 'potential'
  | 'marketValue'
  | 'wage'

export type ScoutFitObjective = 'balanced' | 'title' | 'youth' | 'rebuild'

export const SCOUT_SCORE_COMPONENTS: ScoutScoreComponent[] = [
  'overall',
  'age',
  'historicalFit',
  'potential',
  'marketValue',
  'wage',
]

export const SCOUT_FIT_OBJECTIVES: ScoutFitObjective[] = [
  'balanced',
  'title',
  'youth',
  'rebuild',
]

export type ScoutPlaybookWeights = Partial<Record<ScoutScoreComponent, number>>

export interface ScoutPlaybookPreferences {
  objective?: ScoutFitObjective
  idealAgeMin?: number
  idealAgeMax?: number
  maxMarketValue?: number
  maxWage?: number
}

export interface ScoutPlaybookInput {
  name?: string
  weights?: ScoutPlaybookWeights
  preferences?: ScoutPlaybookPreferences
}

export interface ScoutPlaybookCreateInput extends ScoutPlaybookInput {
  saveId: string
  isDefault?: boolean
}

export interface ScoutPlaybookUpdateInput extends ScoutPlaybookInput {
  isDefault?: boolean
}

export interface ResolvedScoutPlaybook {
  id: string | null
  name: string
  weights: Required<Pick<ScoutPlaybookWeights, 'overall' | 'age' | 'historicalFit' | 'potential'>> & ScoutPlaybookWeights
  preferences: ScoutPlaybookPreferences
  isDefault?: boolean
}

export interface ScoutScoreBreakdownItem {
  key: ScoutScoreComponent
  label: string
  weight: number
  score: number | null
  value: number | string | null
  available: boolean
  weightedScore: number | null
  confidence?: 'high' | 'medium' | 'low' | 'none' | null
  profileSize?: number | null
  reason?: string
}

export interface ScoutScoreResult {
  scoutScore: number | null
  scoutScoreConfidence: 'high' | 'medium' | 'low' | 'fallback' | null
  scoutScoreBreakdown: ScoutScoreBreakdownItem[]
}

export const DEFAULT_SCOUT_PLAYBOOK: ResolvedScoutPlaybook = {
  id: null,
  name: 'Equilibrado',
  weights: {
    overall: 35,
    age: 20,
    historicalFit: 25,
    potential: 20,
  },
  preferences: {
    objective: 'balanced',
  },
  isDefault: true,
}
