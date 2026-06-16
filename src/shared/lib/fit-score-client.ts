import { logger } from './logger.js'

export interface FitScoreCandidate {
  candidate_id: string
  candidate: {
    age: number
    nationality: string | null
    origin_league: string | null
    market_value_eur: number
    fee_type: 'paid'
  }
}

export interface FitScoreResult {
  fit_score: number | null
  confidence: 'high' | 'medium' | 'low' | 'none'
  profile_size: number
}

const FIT_SCORE_TIMEOUT_MS = 3000
// How many consecutive failures before the service is considered "down" (not just degraded).
const DOWN_THRESHOLD = 3

type FitScoreOutcome = 'ok' | 'timeout' | 'http_error' | 'network_error'
export type FitScoreStatus = 'ok' | 'degraded' | 'down' | 'unknown' | 'unconfigured'

// In-process health state. The coupling to the fit-score service fails open
// (null scores), so without this signal the degradation is invisible — this was debt #18.
// Multi-replica note (#19): in-process counters are per-replica; each one
// reports its own health. Since it runs 1 replica today, that's enough; documented so it
// doesn't become implicit shared state.
const health = {
  totalCalls: 0,
  okCalls: 0,
  failedCalls: 0,
  consecutiveFailures: 0,
  lastOutcome: null as FitScoreOutcome | null,
  lastError: null as string | null,
  lastFailureAt: null as string | null,
  lastSuccessAt: null as string | null,
  lastLatencyMs: null as number | null,
}

function record(outcome: FitScoreOutcome, info: { durationMs: number; status?: number; error?: string }) {
  health.totalCalls += 1
  health.lastOutcome = outcome
  health.lastLatencyMs = info.durationMs

  if (outcome === 'ok') {
    health.okCalls += 1
    health.consecutiveFailures = 0
    health.lastSuccessAt = new Date().toISOString()
    return
  }

  health.failedCalls += 1
  health.consecutiveFailures += 1
  health.lastError = info.error ?? `HTTP ${info.status}`
  health.lastFailureAt = new Date().toISOString()

  // Structured signal in production (the old console.warn was silenced in prod — the #18 bug).
  logger.warn(
    {
      service: 'fit-score',
      outcome,
      status: info.status,
      durationMs: info.durationMs,
      consecutiveFailures: health.consecutiveFailures,
      error: info.error,
    },
    `fit-score ${outcome}`,
  )
}

/**
 * Health snapshot of the coupling with the fit-score service, derived from real traffic
 * (passive — reflects how the service responded to users, not a synthetic ping).
 * `lastError` is left out on purpose: it may contain the service's internal host; it goes
 * only to the structured log, not to the public HTTP response.
 */
export function getFitScoreHealth() {
  const configured = !!process.env.FIT_SCORE_SERVICE_URL
  let status: FitScoreStatus
  if (!configured) status = 'unconfigured'
  else if (health.totalCalls === 0) status = 'unknown'
  else if (health.consecutiveFailures >= DOWN_THRESHOLD) status = 'down'
  else if (health.consecutiveFailures > 0) status = 'degraded'
  else status = 'ok'

  return {
    status,
    configured,
    totalCalls: health.totalCalls,
    okCalls: health.okCalls,
    failedCalls: health.failedCalls,
    consecutiveFailures: health.consecutiveFailures,
    lastOutcome: health.lastOutcome,
    lastFailureAt: health.lastFailureAt,
    lastSuccessAt: health.lastSuccessAt,
    lastLatencyMs: health.lastLatencyMs,
  }
}

/** Reseta o estado de saúde — uso exclusivo de testes (estado de módulo persiste entre eles). */
export function resetFitScoreHealthForTest() {
  health.totalCalls = 0
  health.okCalls = 0
  health.failedCalls = 0
  health.consecutiveFailures = 0
  health.lastOutcome = null
  health.lastError = null
  health.lastFailureAt = null
  health.lastSuccessAt = null
  health.lastLatencyMs = null
}

export async function fetchFitScoreBatch(
  clubName: string,
  positionGroup: string,
  objective: string,
  candidates: FitScoreCandidate[]
): Promise<Map<string, FitScoreResult>> {
  const fitScoreUrl = process.env.FIT_SCORE_SERVICE_URL?.replace(/\/+$/, '')

  if (!candidates.length) return new Map()

  if (!fitScoreUrl) {
    logger.warn({ service: 'fit-score', outcome: 'unconfigured' }, 'FIT_SCORE_SERVICE_URL is not configured')
    return new Map()
  }

  const startedAt = Date.now()
  try {
    const res = await fetch(`${fitScoreUrl}/score/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        club_name: clubName,
        position_group: positionGroup,
        objective,
        candidates,
      }),
      signal: AbortSignal.timeout(FIT_SCORE_TIMEOUT_MS),
    })

    const durationMs = Date.now() - startedAt

    if (!res.ok) {
      record('http_error', { durationMs, status: res.status })
      return new Map()
    }

    const data = await res.json() as {
      results: Array<{ candidate_id: string } & FitScoreResult>
    }

    record('ok', { durationMs })

    return new Map(
      data.results.map((r) => [
        r.candidate_id,
        { fit_score: r.fit_score, confidence: r.confidence, profile_size: r.profile_size },
      ])
    )
  } catch (error) {
    const durationMs = Date.now() - startedAt
    // AbortSignal.timeout aborts with TimeoutError (AbortError on older runtimes).
    const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    record(isTimeout ? 'timeout' : 'network_error', {
      durationMs,
      error: error instanceof Error ? error.message : 'score/batch request failed',
    })
    return new Map()
  }
}
