import { formatMarketValue, formatSalary, millions, thousands } from '../../shared/utils/currency.js'

/** Shared "no save" reply so every tool degrades the same way. */
export const noSaveResult = {
  content: [{ type: 'text' as const, text: 'No save found for this user.' }],
}

/** Wraps a plain string into the MCP text-content envelope. */
export function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}

/**
 * Wraps structured data as a JSON text block — the model reads clean key/value pairs instead
 * of parsing a markdown table. Never shown to the user verbatim (the persona reformats it).
 */
export function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
}

/** Minimal shape a scored/fit-enriched player exposes after the scout pipeline. */
export interface ScoredPlayerLike {
  sofifaId: number
  name: string
  positions: string[]
  age: number
  ovr: number
  potential: number | null
  marketValue: number | null
  wage?: number | null
  club: string | null
  scoutScore?: number | null
  scoutScoreConfidence?: string | null
  fitScore?: number | null
  fitConfidence?: string | null
}

/**
 * One bullet line per player, the canonical "player with score" rendering shared by
 * recommend_signings, run_saved_search and the shortlist. No markdown tables (the chat
 * surface can't render them) — inline fields the persona can quote directly.
 */
export function scoredPlayerLine(p: ScoredPlayerLike): string {
  const parts = [
    `• ${p.name} (${p.positions.join('/')})`,
    `${p.age}y`,
    `OVR ${p.ovr}${p.potential != null ? `/POT ${p.potential}` : ''}`,
    formatMarketValue(millions(p.marketValue)),
  ]
  if (p.wage != null) parts.push(formatSalary(thousands(p.wage)) + '/wk')
  parts.push(p.club ?? 'free agent')
  if (p.scoutScore != null) {
    parts.push(`ScoutScore ${p.scoutScore}${p.scoutScoreConfidence ? ` (${p.scoutScoreConfidence})` : ''}`)
  }
  if (p.fitScore != null) parts.push(`Fit ${p.fitScore}`)
  parts.push(`sofifaId ${p.sofifaId}`)
  return parts.join(' · ')
}
