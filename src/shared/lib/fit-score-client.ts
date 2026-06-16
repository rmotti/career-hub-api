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
// A partir de quantas falhas seguidas o serviço é considerado "down" (não só degradado).
const DOWN_THRESHOLD = 3

type FitScoreOutcome = 'ok' | 'timeout' | 'http_error' | 'network_error'
export type FitScoreStatus = 'ok' | 'degraded' | 'down' | 'unknown' | 'unconfigured'

// Estado de saúde em processo. O acoplamento ao serviço de fit-score falha aberto
// (scores nulos), então sem este sinal a degradação é invisível — era o débito #18.
// Observação multi-réplica (#19): contadores em processo são por-réplica; cada uma
// reporta a própria saúde. Como hoje roda 1 réplica, basta; documentado para não virar
// estado compartilhado implícito.
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

  // Sinal estruturado em produção (o antigo console.warn era silenciado em prod — o bug do #18).
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
 * Snapshot de saúde do acoplamento com o serviço de fit-score, derivado do tráfego real
 * (passivo — reflete como o serviço respondeu aos usuários, não um ping sintético).
 * `lastError` fica de fora de propósito: pode conter o host interno do serviço; ele vai
 * só para o log estruturado, não para a resposta HTTP pública.
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
    // AbortSignal.timeout aborta com TimeoutError (AbortError em runtimes mais antigos).
    const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    record(isTimeout ? 'timeout' : 'network_error', {
      durationMs,
      error: error instanceof Error ? error.message : 'score/batch request failed',
    })
    return new Map()
  }
}
