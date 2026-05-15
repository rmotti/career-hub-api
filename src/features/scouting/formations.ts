import type { Position } from '@prisma/client'

export type PositionRequirement = {
  ideal: number
  min: number
}

export type Formation = {
  name: string
  positions: Partial<Record<Position, PositionRequirement>>
}

export const FORMATION_REQUIREMENTS: Record<string, Formation> = {
  '4-3-3': {
    name: '4-3-3',
    positions: {
      GOL: { ideal: 2, min: 2 },
      ZAG: { ideal: 4, min: 3 },
      LD:  { ideal: 2, min: 1 },
      LE:  { ideal: 2, min: 1 },
      MC:  { ideal: 3, min: 2 },
      VOL: { ideal: 2, min: 1 },
      PE:  { ideal: 2, min: 1 },
      PD:  { ideal: 2, min: 1 },
      ATA: { ideal: 2, min: 1 },
    },
  },
  '4-2-3-1': {
    name: '4-2-3-1',
    positions: {
      GOL: { ideal: 2, min: 2 },
      ZAG: { ideal: 4, min: 3 },
      LD:  { ideal: 2, min: 1 },
      LE:  { ideal: 2, min: 1 },
      VOL: { ideal: 3, min: 2 },
      MEI: { ideal: 2, min: 1 },
      ME:  { ideal: 2, min: 1 },
      MD:  { ideal: 2, min: 1 },
      ATA: { ideal: 2, min: 1 },
    },
  },
}

export function getFormation(name: string | undefined): Formation {
  if (!name) return FORMATION_REQUIREMENTS['4-3-3']
  return FORMATION_REQUIREMENTS[name] ?? FORMATION_REQUIREMENTS['4-3-3']
}
