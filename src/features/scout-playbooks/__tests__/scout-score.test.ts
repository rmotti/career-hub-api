import { describe, expect, it } from 'vitest'
import type { Fc26PlayerWithFitScore } from '../../fc26-players/fc26-players.service.js'
import { calculateScoutScore, normalizePreferences, normalizeWeights } from '../scout-score.js'
import { DEFAULT_SCOUT_PLAYBOOK, ResolvedScoutPlaybook, ScoutPlaybookWeights } from '../scout-playbooks.types.js'

const basePlayer = {
  ovr: 80,
  potential: 88,
  age: 22,
  marketValue: 50,
  wage: 120,
  fitScore: null,
  fitConfidence: null,
  fitProfileSize: null,
} as Fc26PlayerWithFitScore

function player(overrides: Partial<Fc26PlayerWithFitScore>): Fc26PlayerWithFitScore {
  return { ...basePlayer, ...overrides }
}

// Single-component playbook helper — the weights type requires the four base components.
function playbook(weights: Partial<ScoutPlaybookWeights>, preferences = {}): ResolvedScoutPlaybook {
  return {
    id: null,
    name: 'test',
    weights: { overall: 0, age: 0, historicalFit: 0, potential: 0, ...weights },
    preferences: { objective: 'balanced', ...preferences },
  }
}

const scoreOf = (p: Fc26PlayerWithFitScore, book: ResolvedScoutPlaybook, ctx = {}) =>
  calculateScoutScore(p, book, ctx).scoutScore

describe('scout score — overall (fixed 50→0 / 95→100)', () => {
  const book = playbook({ overall: 1 })
  it('maps the OVR band linearly', () => {
    expect(scoreOf(player({ ovr: 50 }), book)).toBe(0)
    expect(scoreOf(player({ ovr: 80 }), book)).toBe(66.7)
    expect(scoreOf(player({ ovr: 95 }), book)).toBe(100)
  })
  it('clamps above the ceiling and below the floor', () => {
    expect(scoreOf(player({ ovr: 99 }), book)).toBe(100)
    expect(scoreOf(player({ ovr: 40 }), book)).toBe(0)
  })
})

describe('scout score — age (convex curve, younger is better)', () => {
  const book = playbook({ age: 1 })
  it.each([
    [16, 100],
    [22, 86],
    [25, 77],
    [30, 52],
    [34, 30],
    [40, 0],
  ])('age %i scores %i', (age, expected) => {
    expect(scoreOf(player({ age }), book)).toBe(expected)
  })
})

describe('scout score — potential is the real ceiling (not upside)', () => {
  const book = playbook({ potential: 1 })
  it('scores the potential level on the same fixed scale as overall', () => {
    // A weak prospect must NOT outscore a stronger one: 55→70 (44.4) < 88→90 (88.9).
    expect(scoreOf(player({ ovr: 55, potential: 70 }), book)).toBe(44.4)
    expect(scoreOf(player({ ovr: 88, potential: 90 }), book)).toBe(88.9)
    expect(scoreOf(player({ ovr: 80, potential: 95 }), book)).toBe(100)
    expect(scoreOf(player({ ovr: 80, potential: 49 }), book)).toBe(0)
  })
})

describe('scout score — historical fit', () => {
  it('scores 0 (kept, not dropped) when no profile is available', () => {
    const result = calculateScoutScore(player({ ovr: 80 }), playbook({ overall: 1, historicalFit: 1 }))
    expect(result.scoutScore).toBe(33.4) // (66.7 + 0) / 2
    expect(result.scoutScoreConfidence).toBe('fallback')
    expect(result.scoutScoreBreakdown.find((i) => i.key === 'historicalFit')).toMatchObject({
      available: true,
      score: 0,
    })
  })

  it('uses fit × 100 when the service returns a usable value', () => {
    const result = calculateScoutScore(
      player({ fitScore: 0.72, fitConfidence: 'medium', fitProfileSize: 18 }),
      playbook({ historicalFit: 1 }),
    )
    expect(result.scoutScore).toBe(72)
    expect(result.scoutScoreConfidence).toBe('medium')
  })
})

describe('scout score — cost is budget-relative', () => {
  it('scores marketValue against the reference (cheaper = higher)', () => {
    const book = playbook({ marketValue: 1 })
    expect(scoreOf(player({ marketValue: 0 }), book, { marketValueRef: 100 })).toBe(100)
    expect(scoreOf(player({ marketValue: 50 }), book, { marketValueRef: 100 })).toBe(50)
    expect(scoreOf(player({ marketValue: 100 }), book, { marketValueRef: 100 })).toBe(0)
  })

  it('drops marketValue (score null) when there is no budget reference', () => {
    const result = calculateScoutScore(player({ marketValue: 50 }), playbook({ marketValue: 1 }))
    expect(result.scoutScore).toBeNull()
    expect(result.scoutScoreBreakdown.find((i) => i.key === 'marketValue')).toMatchObject({ available: false })
  })

  it('scores wage only when a maxWage reference is given; otherwise drops', () => {
    const book = playbook({ wage: 1 })
    expect(scoreOf(player({ wage: 100 }), book, { wageRef: 200 })).toBe(50)
    expect(calculateScoutScore(player({ wage: 100 }), book).scoutScore).toBeNull()
  })
})

describe('scout score — default playbook end-to-end', () => {
  it('blends every component with the budget context', () => {
    // overall 66.7·.30 + potential(88→84.4)·.15 + age22(86)·.15 + fit(0)·.15 + market(50/100→50)·.25
    const result = calculateScoutScore(basePlayer, DEFAULT_SCOUT_PLAYBOOK, { marketValueRef: 100 })
    expect(result.scoutScore).toBe(58.1)
    expect(result.scoutScoreConfidence).toBe('fallback')
  })
})

describe('scout score — normalization', () => {
  it('ignores unknown weight keys and falls back to the default weights', () => {
    expect(normalizeWeights({ overall: 50, unknown: 100 } as never)).toEqual({
      overall: 50,
      potential: 15,
      age: 15,
      historicalFit: 15,
      marketValue: 25,
    })
  })

  it('drops idealAge*, sanitizes objective, keeps the budget caps', () => {
    expect(
      normalizePreferences({ objective: 'attack', idealAgeMin: 60, idealAgeMax: 16, maxMarketValue: 50, maxWage: 200 } as never),
    ).toEqual({
      objective: 'balanced',
      maxMarketValue: 50,
      maxWage: 200,
    })
  })
})
