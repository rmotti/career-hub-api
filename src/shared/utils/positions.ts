import type { Position } from '@prisma/client'

/**
 * FC26 stores positions as PT-BR codes (the codes the BR build of the game uses).
 * The chatbot speaks English, and the gpt-4o-mini model mistranslates these codes from
 * memory (e.g. rendering "PE" as "right-wing"). So we translate at the source: every tool
 * line shown to the user emits the English label via these helpers instead of the raw code.
 */
const POSITION_LABELS: Record<Position, string> = {
  GOL: 'GK',
  ZAG: 'CB',
  LD: 'RB',
  LE: 'LB',
  VOL: 'CDM',
  MC: 'CM',
  ME: 'LM',
  MD: 'RM',
  MEI: 'CAM',
  PE: 'LW',
  PD: 'RW',
  SA: 'CF',
  ATA: 'ST',
}

/** PT-BR FC26 position code → English label (e.g. "PE" → "LW"). Falls back to the raw code. */
export function positionLabel(code: string): string {
  return POSITION_LABELS[code as Position] ?? code
}

/** Translate a list of position codes to English labels (e.g. ["LE","ME"] → "LB/LM"). */
export function positionLabels(codes: string[], sep = '/'): string {
  return codes.map(positionLabel).join(sep)
}
