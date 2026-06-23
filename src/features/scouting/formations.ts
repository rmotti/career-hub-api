import type { Position } from '@prisma/client'

export type PositionRequirement = {
  ideal: number
  min: number
}

export type Formation = {
  name: string
  positions: Partial<Record<Position, PositionRequirement>>
}

// GK is always 2/2. Back-fours use LD+LE (full-backs); back-threes drop them and stack ZAG.
// Wing-backs in 3-x and 5-x shapes are modelled as ME/MD (the FC26 wide-midfield codes), since
// the dataset has no dedicated wing-back code.
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
  '4-4-2': {
    name: '4-4-2',
    positions: {
      GOL: { ideal: 2, min: 2 },
      ZAG: { ideal: 4, min: 3 },
      LD:  { ideal: 2, min: 1 },
      LE:  { ideal: 2, min: 1 },
      MC:  { ideal: 3, min: 2 },
      ME:  { ideal: 2, min: 1 },
      MD:  { ideal: 2, min: 1 },
      ATA: { ideal: 3, min: 2 },
    },
  },
  '4-4-2 Diamante': {
    name: '4-4-2 Diamante',
    positions: {
      GOL: { ideal: 2, min: 2 },
      ZAG: { ideal: 4, min: 3 },
      LD:  { ideal: 2, min: 1 },
      LE:  { ideal: 2, min: 1 },
      VOL: { ideal: 2, min: 1 },
      MC:  { ideal: 2, min: 1 },
      MEI: { ideal: 2, min: 1 },
      ATA: { ideal: 3, min: 2 },
    },
  },
  '4-4-1-1': {
    name: '4-4-1-1',
    positions: {
      GOL: { ideal: 2, min: 2 },
      ZAG: { ideal: 4, min: 3 },
      LD:  { ideal: 2, min: 1 },
      LE:  { ideal: 2, min: 1 },
      MC:  { ideal: 3, min: 2 },
      ME:  { ideal: 2, min: 1 },
      MD:  { ideal: 2, min: 1 },
      SA:  { ideal: 2, min: 1 },
      ATA: { ideal: 2, min: 1 },
    },
  },
  '4-1-4-1': {
    name: '4-1-4-1',
    positions: {
      GOL: { ideal: 2, min: 2 },
      ZAG: { ideal: 4, min: 3 },
      LD:  { ideal: 2, min: 1 },
      LE:  { ideal: 2, min: 1 },
      VOL: { ideal: 2, min: 1 },
      MC:  { ideal: 2, min: 1 },
      ME:  { ideal: 2, min: 1 },
      MD:  { ideal: 2, min: 1 },
      ATA: { ideal: 2, min: 1 },
    },
  },
  '4-1-2-1-2': {
    name: '4-1-2-1-2',
    positions: {
      GOL: { ideal: 2, min: 2 },
      ZAG: { ideal: 4, min: 3 },
      LD:  { ideal: 2, min: 1 },
      LE:  { ideal: 2, min: 1 },
      VOL: { ideal: 2, min: 1 },
      MC:  { ideal: 2, min: 1 },
      MEI: { ideal: 2, min: 1 },
      ATA: { ideal: 3, min: 2 },
    },
  },
  '4-3-2-1': {
    name: '4-3-2-1',
    positions: {
      GOL: { ideal: 2, min: 2 },
      ZAG: { ideal: 4, min: 3 },
      LD:  { ideal: 2, min: 1 },
      LE:  { ideal: 2, min: 1 },
      MC:  { ideal: 2, min: 1 },
      VOL: { ideal: 2, min: 1 },
      MEI: { ideal: 2, min: 1 },
      ATA: { ideal: 2, min: 1 },
    },
  },
  '4-3-3 Falso 9': {
    name: '4-3-3 Falso 9',
    positions: {
      GOL: { ideal: 2, min: 2 },
      ZAG: { ideal: 4, min: 3 },
      LD:  { ideal: 2, min: 1 },
      LE:  { ideal: 2, min: 1 },
      MC:  { ideal: 3, min: 2 },
      VOL: { ideal: 2, min: 1 },
      PE:  { ideal: 2, min: 1 },
      PD:  { ideal: 2, min: 1 },
      SA:  { ideal: 2, min: 1 }, // false 9 → second striker, not an out-and-out ATA
    },
  },
  '4-5-1': {
    name: '4-5-1',
    positions: {
      GOL: { ideal: 2, min: 2 },
      ZAG: { ideal: 4, min: 3 },
      LD:  { ideal: 2, min: 1 },
      LE:  { ideal: 2, min: 1 },
      MC:  { ideal: 3, min: 2 },
      ME:  { ideal: 2, min: 1 },
      MD:  { ideal: 2, min: 1 },
      ATA: { ideal: 2, min: 1 },
    },
  },
  // ---- Three-at-the-back shapes: no full-backs (LD/LE), wing-backs modelled as ME/MD ----
  '3-4-2-1': {
    name: '3-4-2-1',
    positions: {
      GOL: { ideal: 2, min: 2 },
      ZAG: { ideal: 5, min: 3 }, // 3 starters + cover
      VOL: { ideal: 3, min: 2 },
      ME:  { ideal: 2, min: 1 }, // left wing-back
      MD:  { ideal: 2, min: 1 }, // right wing-back
      MEI: { ideal: 3, min: 2 }, // the two "2" behind the striker
      ATA: { ideal: 2, min: 1 },
    },
  },
  '3-4-3': {
    name: '3-4-3',
    positions: {
      GOL: { ideal: 2, min: 2 },
      ZAG: { ideal: 5, min: 3 },
      VOL: { ideal: 3, min: 2 },
      ME:  { ideal: 2, min: 1 },
      MD:  { ideal: 2, min: 1 },
      PE:  { ideal: 2, min: 1 },
      PD:  { ideal: 2, min: 1 },
      ATA: { ideal: 2, min: 1 },
    },
  },
  '3-5-2': {
    name: '3-5-2',
    positions: {
      GOL: { ideal: 2, min: 2 },
      ZAG: { ideal: 5, min: 3 },
      ME:  { ideal: 2, min: 1 },
      MD:  { ideal: 2, min: 1 },
      MC:  { ideal: 2, min: 1 },
      VOL: { ideal: 2, min: 1 },
      MEI: { ideal: 2, min: 1 },
      ATA: { ideal: 3, min: 2 },
    },
  },
  '3-3-3-1': {
    name: '3-3-3-1',
    positions: {
      GOL: { ideal: 2, min: 2 },
      ZAG: { ideal: 5, min: 3 },
      VOL: { ideal: 3, min: 2 },
      MC:  { ideal: 2, min: 1 },
      MEI: { ideal: 3, min: 2 },
      ATA: { ideal: 2, min: 1 },
    },
  },
  // ---- Five-at-the-back shapes: wing-backs as ME/MD, three centre-backs ----
  '5-3-2': {
    name: '5-3-2',
    positions: {
      GOL: { ideal: 2, min: 2 },
      ZAG: { ideal: 5, min: 3 },
      ME:  { ideal: 2, min: 1 },
      MD:  { ideal: 2, min: 1 },
      MC:  { ideal: 2, min: 1 },
      VOL: { ideal: 2, min: 1 },
      ATA: { ideal: 3, min: 2 },
    },
  },
  '5-2-3': {
    name: '5-2-3',
    positions: {
      GOL: { ideal: 2, min: 2 },
      ZAG: { ideal: 5, min: 3 },
      ME:  { ideal: 2, min: 1 },
      MD:  { ideal: 2, min: 1 },
      MC:  { ideal: 2, min: 1 },
      VOL: { ideal: 2, min: 1 },
      PE:  { ideal: 2, min: 1 },
      PD:  { ideal: 2, min: 1 },
      ATA: { ideal: 2, min: 1 },
    },
  },
  '5-4-1': {
    name: '5-4-1',
    positions: {
      GOL: { ideal: 2, min: 2 },
      ZAG: { ideal: 5, min: 3 },
      ME:  { ideal: 2, min: 1 },
      MD:  { ideal: 2, min: 1 },
      MC:  { ideal: 2, min: 1 },
      VOL: { ideal: 2, min: 1 },
      ATA: { ideal: 2, min: 1 },
    },
  },
}

/** Every formation the system can evaluate — drives the tool enums and persona guidance. */
export const FORMATION_NAMES = Object.keys(FORMATION_REQUIREMENTS) as [string, ...string[]]

export function getFormation(name: string | undefined): Formation {
  if (!name) return FORMATION_REQUIREMENTS['4-3-3']
  return FORMATION_REQUIREMENTS[name] ?? FORMATION_REQUIREMENTS['4-3-3']
}
