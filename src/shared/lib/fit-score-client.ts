const FIT_SCORE_URL = process.env.FIT_SCORE_SERVICE_URL

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
  if (!FIT_SCORE_URL || !candidates.length) return new Map()

  try {
    const res = await fetch(`${FIT_SCORE_URL}/score/batch`, {
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

    if (!res.ok) return new Map()

    const data = await res.json() as {
      results: Array<{ candidate_id: string } & FitScoreResult>
    }

    return new Map(
      data.results.map((r) => [
        r.candidate_id,
        { fit_score: r.fit_score, confidence: r.confidence, profile_size: r.profile_size },
      ])
    )
  } catch {
    return new Map()
  }
}
