import { describe, expect, it } from 'vitest'
import type { Fc26PlayerWithFitScore } from '../../fc26-players/fc26-players.service.js'
import { calculateScoutScore, normalizePreferences, normalizeWeights } from '../scout-score.js'
import { DEFAULT_SCOUT_PLAYBOOK } from '../scout-playbooks.types.js'

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

describe('scout score', () => {
  it('renormalizes the final score when historical fit is unavailable', () => {
    const result = calculateScoutScore(basePlayer, DEFAULT_SCOUT_PLAYBOOK)

    expect(result.scoutScore).toBe(87.5)
    expect(result.scoutScoreConfidence).toBe('fallback')
    expect(result.scoutScoreBreakdown.find((item) => item.key === 'historicalFit')).toMatchObject({
      available: false,
      score: null,
    })
  })

  it('includes historical fit when the fit-score service returns a usable value', () => {
    const result = calculateScoutScore({
      ...basePlayer,
      fitScore: 0.72,
      fitConfidence: 'medium',
      fitProfileSize: 18,
    }, DEFAULT_SCOUT_PLAYBOOK)

    expect(result.scoutScore).toBe(83.6)
    expect(result.scoutScoreConfidence).toBe('medium')
    expect(result.scoutScoreBreakdown.find((item) => item.key === 'historicalFit')).toMatchObject({
      available: true,
      score: 72,
      profileSize: 18,
    })
  })

  it('ignores unknown weight keys and sanitizes invalid preferences', () => {
    const weights = normalizeWeights({ overall: 50, unknown: 100 } as never)
    const preferences = normalizePreferences({ objective: 'attack', idealAgeMin: 60, idealAgeMax: 16 } as never)

    expect(weights).toEqual({
      ...DEFAULT_SCOUT_PLAYBOOK.weights,
      overall: 50,
    })
    expect(weights).not.toHaveProperty('unknown')
    expect(preferences).toEqual({
      objective: 'balanced',
      idealAgeMin: 16,
      idealAgeMax: 45,
    })
  })
})
