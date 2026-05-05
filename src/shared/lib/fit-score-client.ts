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

export async function fetchFitScoreBatch(
  clubName: string,
  positionGroup: string,
  objective: string,
  candidates: FitScoreCandidate[]
): Promise<Map<string, FitScoreResult>> {
  const fitScoreUrl = process.env.FIT_SCORE_SERVICE_URL?.replace(/\/+$/, '')

  if (!candidates.length) return new Map()

  if (!fitScoreUrl) {
    warnFitScore('FIT_SCORE_SERVICE_URL is not configured')
    return new Map()
  }

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
      signal: AbortSignal.timeout(3000),
    })

    if (!res.ok) {
      warnFitScore(`score/batch returned HTTP ${res.status}`)
      return new Map()
    }

    const data = await res.json() as {
      results: Array<{ candidate_id: string } & FitScoreResult>
    }

    return new Map(
      data.results.map((r) => [
        r.candidate_id,
        { fit_score: r.fit_score, confidence: r.confidence, profile_size: r.profile_size },
      ])
    )
  } catch (error) {
    warnFitScore(error instanceof Error ? error.message : 'score/batch request failed')
    return new Map()
  }
}

function warnFitScore(message: string) {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') return
  console.warn(`[FitScore] ${message}`)
}
