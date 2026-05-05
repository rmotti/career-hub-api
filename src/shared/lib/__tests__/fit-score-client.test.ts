import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchFitScoreBatch, FitScoreCandidate } from '../fit-score-client.js'

const candidates: FitScoreCandidate[] = [
  {
    candidate_id: 'sofifa_1',
    candidate: {
      age: 24,
      nationality: 'Brazil',
      origin_league: 'ES1',
      market_value_eur: 50_000_000,
      fee_type: 'paid',
    },
  },
]

describe('fit score client', () => {
  beforeEach(() => {
    process.env.FIT_SCORE_SERVICE_URL = 'https://fit-score.example.com/'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete process.env.FIT_SCORE_SERVICE_URL
  })

  it('posts candidates to the batch endpoint and maps results by candidate id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        results: [
          {
            candidate_id: 'sofifa_1',
            fit_score: 0.42,
            confidence: 'medium',
            profile_size: 14,
          },
        ],
      }),
    })

    vi.stubGlobal('fetch', fetchMock)

    const results = await fetchFitScoreBatch('Barcelona', 'CM', 'balanced', candidates)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://fit-score.example.com/score/batch',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(results.get('sofifa_1')).toEqual({
      fit_score: 0.42,
      confidence: 'medium',
      profile_size: 14,
    })
  })

  it('does not call the service when FIT_SCORE_SERVICE_URL is missing', async () => {
    delete process.env.FIT_SCORE_SERVICE_URL
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const results = await fetchFitScoreBatch('Barcelona', 'CM', 'balanced', candidates)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(results.size).toBe(0)
  })

  it('returns an empty map when the service response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    const results = await fetchFitScoreBatch('Barcelona', 'CM', 'balanced', candidates)

    expect(results.size).toBe(0)
  })
})
