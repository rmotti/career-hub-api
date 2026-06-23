import { identifyGaps } from '../scouting/scouting.service.js'

const POSITION_LABEL: Record<string, string> = {
  GOL: 'goalkeepers',
  ZAG: 'centre-backs',
  LD: 'right-backs',
  LE: 'left-backs',
  VOL: 'defensive mids',
  MC: 'central mids',
  MD: 'right mids',
  ME: 'left mids',
  MEI: 'attacking mids',
  PD: 'right wingers',
  PE: 'left wingers',
  SA: 'second strikers',
  ATA: 'strikers',
}

/**
 * Up to 3 grounded follow-up suggestions for the chat UI, derived from real squad state (the
 * formation gaps) rather than invented by the model — so they're deterministic and cheap. Fails
 * open: any error (no active club, etc.) yields an empty list, never breaks the chat reply.
 */
export async function getSaveSuggestions(userId: string, saveId: string): Promise<string[]> {
  const gaps = await identifyGaps(userId, saveId, { formation: '4-3-3' }).catch(() => [])

  const suggestions: string[] = []
  const pressing = gaps
    .filter((g) => g.severity === 'critical' || g.severity === 'moderate')
    .slice(0, 2)

  for (const g of pressing) {
    suggestions.push(`Scout ${POSITION_LABEL[g.position] ?? g.position}`)
  }
  if (gaps.length >= 2) suggestions.push('Plan my transfer window')
  suggestions.push('Review my shortlist')

  return [...new Set(suggestions)].slice(0, 3)
}
