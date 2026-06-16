import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { healthRoutes } from '../health.routes.js'
import {
  fetchFitScoreBatch,
  FitScoreCandidate,
  resetFitScoreHealthForTest,
} from '../../../shared/lib/fit-score-client.js'

const candidates: FitScoreCandidate[] = [
  {
    candidate_id: 'sofifa_1',
    candidate: { age: 24, nationality: 'Brazil', origin_league: 'ES1', market_value_eur: 50_000_000, fee_type: 'paid' },
  },
]

async function buildApp() {
  const app = Fastify()
  await app.register(healthRoutes, { prefix: '/api' })
  await app.ready()
  return app
}

describe('health routes', () => {
  beforeEach(() => {
    resetFitScoreHealthForTest()
    process.env.FIT_SCORE_SERVICE_URL = 'https://fit-score.example.com/'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.FIT_SCORE_SERVICE_URL
  })

  it('GET /api/health returns 200 ok', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
    await app.close()
  })

  it('GET /api/health/fit-score returns 200 when healthy', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/health/fit-score' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'unknown', configured: true })
    await app.close()
  })

  it('GET /api/health/fit-score returns 503 when the service is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    for (let i = 0; i < 3; i++) {
      await fetchFitScoreBatch('Barcelona', 'CM', 'balanced', candidates)
    }

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/health/fit-score' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ status: 'down', consecutiveFailures: 3 })
    await app.close()
  })
})
