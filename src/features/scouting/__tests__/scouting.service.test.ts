import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../shared/lib/prisma.js', () => ({
  prisma: {
    save: { findFirst: vi.fn() },
    player: { findMany: vi.fn() },
    fc26Player: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}))

vi.mock('../../fc26-players/fc26-players.service.js', () => ({
  listFc26Players: vi.fn(),
}))

import { prisma } from '../../../shared/lib/prisma.js'
import { listFc26Players } from '../../fc26-players/fc26-players.service.js'
import { evaluateSigningFit, identifyGaps, searchTransferTargets } from '../scouting.service.js'

const mockedPrisma = prisma as unknown as {
  save: { findFirst: ReturnType<typeof vi.fn> }
  player: { findMany: ReturnType<typeof vi.fn> }
  fc26Player: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  mockedPrisma.save.findFirst.mockReset()
  mockedPrisma.player.findMany.mockReset()
  mockedPrisma.fc26Player.findUnique.mockReset()
  mockedPrisma.fc26Player.findMany.mockReset()
  mockedPrisma.fc26Player.findMany.mockResolvedValue([])
  vi.mocked(listFc26Players).mockReset()
})

describe('identifyGaps', () => {
  it('flags critical gap when count < min for a required position', async () => {
    mockedPrisma.save.findFirst.mockResolvedValue({
      id: 's1',
      budget: 50,
      clubStints: [{ id: 'cs1', club: 'X' }],
    })
    mockedPrisma.player.findMany.mockResolvedValue([
      { position: 'GOL', age: 30, ovr: 80 },
      { position: 'ZAG', age: 28, ovr: 82 },
      { position: 'ZAG', age: 26, ovr: 80 },
      { position: 'ZAG', age: 24, ovr: 79 },
      { position: 'LD', age: 27, ovr: 78 },
      { position: 'LE', age: 25, ovr: 77 },
      { position: 'MC', age: 26, ovr: 80 },
      { position: 'MC', age: 28, ovr: 79 },
      { position: 'MC', age: 24, ovr: 78 },
      { position: 'VOL', age: 27, ovr: 80 },
      { position: 'PE', age: 23, ovr: 79 },
      { position: 'PD', age: 24, ovr: 80 },
      { position: 'ATA', age: 26, ovr: 83 },
    ])

    const gaps = await identifyGaps('user-1', 's1', { formation: '4-3-3' })

    const gkGap = gaps.find((g) => g.position === 'GOL')
    expect(gkGap).toBeDefined()
    expect(gkGap?.severity).toBe('critical')
    expect(gkGap?.count).toBe(1)
  })

  // Full back-three squad so depth counts are satisfied; quality is judged starter-first.
  function backThreeSquad(overrides: Array<{ position: string; age: number; ovr: number }>) {
    return [
      { position: 'GOL', age: 27, ovr: 84 },
      { position: 'GOL', age: 24, ovr: 80 },
      { position: 'ZAG', age: 26, ovr: 85 },
      { position: 'ZAG', age: 28, ovr: 84 },
      { position: 'ZAG', age: 25, ovr: 83 },
      { position: 'ZAG', age: 22, ovr: 81 },
      { position: 'ZAG', age: 20, ovr: 79 },
      { position: 'VOL', age: 26, ovr: 84 },
      { position: 'VOL', age: 24, ovr: 82 },
      { position: 'VOL', age: 23, ovr: 81 },
      { position: 'ME', age: 25, ovr: 83 },
      { position: 'ME', age: 22, ovr: 80 },
      { position: 'MD', age: 26, ovr: 83 },
      { position: 'MD', age: 23, ovr: 80 },
      { position: 'MEI', age: 24, ovr: 84 },
      { position: 'MEI', age: 27, ovr: 83 },
      { position: 'MEI', age: 21, ovr: 80 },
      ...overrides,
    ]
  }

  it('judges quality off the starter (top OVR), not an average — flags a starter below squad level', async () => {
    mockedPrisma.save.findFirst.mockResolvedValue({ id: 's1', budget: 50, clubStints: [{ id: 'cs1', club: 'X' }] })
    // ATA has two players: a starter at 78 plus a 76 backup. Squad best is 85 → starter 7 below → gap.
    // Their average (77) is irrelevant to the rule.
    mockedPrisma.player.findMany.mockResolvedValue(
      backThreeSquad([
        { position: 'ATA', age: 24, ovr: 78 },
        { position: 'ATA', age: 22, ovr: 76 },
      ]),
    )

    const gaps = await identifyGaps('user-1', 's1', { formation: '3-4-2-1' })
    const ataGap = gaps.find((g) => g.position === 'ATA')
    expect(ataGap).toBeDefined()
    expect(ataGap?.starterOvr).toBe(78) // top OVR, not the 77 average
    expect(ataGap?.reason).toMatch(/abaixo do melhor do elenco/)
  })

  it('flags a bench drop-off when the backup is far below the starter', async () => {
    mockedPrisma.save.findFirst.mockResolvedValue({ id: 's1', budget: 50, clubStints: [{ id: 'cs1', club: 'X' }] })
    // ATA starter is squad-level (85) but the only backup is a 72 → 13 OVR drop-off → thin/weak bench.
    mockedPrisma.player.findMany.mockResolvedValue(
      backThreeSquad([
        { position: 'ATA', age: 25, ovr: 85 },
        { position: 'ATA', age: 19, ovr: 72 },
      ]),
    )

    const gaps = await identifyGaps('user-1', 's1', { formation: '3-4-2-1' })
    const ataGap = gaps.find((g) => g.position === 'ATA')
    expect(ataGap).toBeDefined()
    expect(ataGap?.starterOvr).toBe(85)
    expect(ataGap?.benchOvr).toBe(72)
    expect(ataGap?.reason).toMatch(/Banco fraco/)
  })

  it('does not flag a position with a squad-level starter and adequate backup', async () => {
    mockedPrisma.save.findFirst.mockResolvedValue({ id: 's1', budget: 50, clubStints: [{ id: 'cs1', club: 'X' }] })
    mockedPrisma.player.findMany.mockResolvedValue(
      backThreeSquad([
        { position: 'ATA', age: 25, ovr: 85 },
        { position: 'ATA', age: 23, ovr: 82 },
      ]),
    )

    const gaps = await identifyGaps('user-1', 's1', { formation: '3-4-2-1' })
    expect(gaps.find((g) => g.position === 'ATA')).toBeUndefined()
  })

  it('counts a secondary-position player as cover so the position is not a critical gap', async () => {
    mockedPrisma.save.findFirst.mockResolvedValue({ id: 's1', budget: 50, clubStints: [{ id: 'cs1', club: 'X' }] })
    // 4-3-3 needs LE. No specialist LE on the roster, but a strong LM (Grimaldo, OVR 85) lists LE
    // as an alternative position → covers the slot. Not a gap; flagged as cover-only.
    mockedPrisma.player.findMany.mockResolvedValue([
      { position: 'GOL', age: 27, ovr: 84, alternativePosition: { positions: [] } },
      { position: 'GOL', age: 24, ovr: 80, alternativePosition: { positions: [] } },
      { position: 'ZAG', age: 26, ovr: 84, alternativePosition: { positions: [] } },
      { position: 'ZAG', age: 28, ovr: 83, alternativePosition: { positions: [] } },
      { position: 'ZAG', age: 25, ovr: 82, alternativePosition: { positions: [] } },
      { position: 'LD', age: 27, ovr: 82, alternativePosition: { positions: [] } },
      { position: 'ME', age: 29, ovr: 85, alternativePosition: { positions: ['LE'] } }, // Grimaldo
      { position: 'MC', age: 26, ovr: 84, alternativePosition: { positions: [] } },
      { position: 'MC', age: 24, ovr: 82, alternativePosition: { positions: [] } },
      { position: 'VOL', age: 27, ovr: 83, alternativePosition: { positions: [] } },
      { position: 'VOL', age: 23, ovr: 81, alternativePosition: { positions: [] } },
      { position: 'PE', age: 23, ovr: 83, alternativePosition: { positions: [] } },
      { position: 'PD', age: 24, ovr: 83, alternativePosition: { positions: [] } },
      { position: 'ATA', age: 26, ovr: 86, alternativePosition: { positions: [] } },
      { position: 'ATA', age: 22, ovr: 82, alternativePosition: { positions: [] } },
    ])

    const gaps = await identifyGaps('user-1', 's1', { formation: '4-3-3' })
    const leGap = gaps.find((g) => g.position === 'LE')
    // 4-3-3 wants 2 LE (ideal), min 1. Grimaldo gives count 1 → still a moderate depth gap (ideal),
    // but NOT critical, and the cover is recognised at full OVR.
    expect(leGap?.severity).not.toBe('critical')
    expect(leGap?.starterOvr).toBe(85) // Grimaldo, at full OVR
    expect(leGap?.coveredBySecondaryOnly).toBe(true)
  })

  it('does not report full-back gaps for a back-three formation', async () => {
    mockedPrisma.save.findFirst.mockResolvedValue({ id: 's1', budget: 50, clubStints: [{ id: 'cs1', club: 'X' }] })
    mockedPrisma.player.findMany.mockResolvedValue(
      backThreeSquad([
        { position: 'ATA', age: 25, ovr: 85 },
        { position: 'ATA', age: 23, ovr: 82 },
      ]),
    )

    const gaps = await identifyGaps('user-1', 's1', { formation: '3-4-2-1' })
    expect(gaps.find((g) => g.position === 'LE')).toBeUndefined()
    expect(gaps.find((g) => g.position === 'LD')).toBeUndefined()
  })
})

describe('searchTransferTargets', () => {
  it('delegates to listFc26Players with mapped filters', async () => {
    vi.mocked(listFc26Players).mockResolvedValue({
      players: [],
      total: 0,
      limit: 20,
      offset: 0,
    })

    await searchTransferTargets('user-1', {
      position: 'ATA',
      maxAge: 24,
      minOverall: 80,
      maxValue: 50,
      saveId: 's1',
    })

    expect(listFc26Players).toHaveBeenCalledWith({
      positions: ['ATA'],
      maxAge: 24,
      minOvr: 80,
      maxMarketValue: 50,
      limit: 20,
      saveId: 's1',
    })
  })
})

describe('evaluateSigningFit', () => {
  it('returns poor verdict when market value exceeds budget', async () => {
    mockedPrisma.save.findFirst.mockResolvedValue({
      id: 's1',
      budget: 30,
      clubStints: [{ id: 'cs1', club: 'X' }],
    })
    mockedPrisma.fc26Player.findUnique.mockResolvedValue({
      sofifaId: 1,
      name: 'Test Player',
      positions: ['ATA'],
      ovr: 88,
      potential: 90,
      age: 25,
      marketValue: 100,
      club: 'Other FC',
    })
    mockedPrisma.player.findMany.mockResolvedValue([{ age: 28, ovr: 80 }])

    const result = await evaluateSigningFit('user-1', 's1', 1)

    expect(result.verdict).toBe('poor')
    expect(result.costAnalysis.affordable).toBe(false)
    expect(result.fitAnalysis.ovrDelta).toBe(8)
  })

  it('returns strong verdict when player is affordable and an upgrade', async () => {
    mockedPrisma.save.findFirst.mockResolvedValue({
      id: 's1',
      budget: 200,
      clubStints: [{ id: 'cs1', club: 'X' }],
    })
    mockedPrisma.fc26Player.findUnique.mockResolvedValue({
      sofifaId: 2,
      name: 'Star',
      positions: ['ATA'],
      ovr: 90,
      potential: 92,
      age: 24,
      marketValue: 150,
      club: 'Other FC',
    })
    mockedPrisma.player.findMany.mockResolvedValue([{ age: 30, ovr: 85 }])

    const result = await evaluateSigningFit('user-1', 's1', 2)

    expect(result.verdict).toBe('strong')
    expect(result.costAnalysis.affordable).toBe(true)
    expect(result.fitAnalysis.ovrDelta).toBe(5)
  })

  it('fills alternatives with same-primary-position dataset players, capped at the budget', async () => {
    mockedPrisma.save.findFirst.mockResolvedValue({
      id: 's1',
      budget: 30,
      clubStints: [{ id: 'cs1', club: 'X' }],
    })
    mockedPrisma.fc26Player.findUnique.mockResolvedValue({
      sofifaId: 1,
      name: 'Target',
      positions: ['ATA'],
      ovr: 88,
      potential: 90,
      age: 25,
      marketValue: 100,
      club: 'Other FC',
    })
    mockedPrisma.player.findMany.mockResolvedValue([{ age: 28, ovr: 80 }])
    // ordered by ovr desc at the DB level (mocked); includes a secondary-position-only player to drop
    mockedPrisma.fc26Player.findMany.mockResolvedValue([
      { sofifaId: 11, name: 'Alt One', positions: ['ATA'], ovr: 84, potential: 86, age: 23, marketValue: 25, club: 'A' },
      { sofifaId: 12, name: 'Winger', positions: ['PD', 'ATA'], ovr: 83, potential: 85, age: 22, marketValue: 20, club: 'B' },
      { sofifaId: 13, name: 'Alt Two', positions: ['ATA'], ovr: 82, potential: 84, age: 24, marketValue: 18, club: 'C' },
    ])

    const result = await evaluateSigningFit('user-1', 's1', 1)

    // cap = budget (30), exclude the target itself
    const where = mockedPrisma.fc26Player.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ sofifaId: { not: 1 }, positions: { has: 'ATA' }, marketValue: { lte: 30 } })

    // secondary-position player (sofifaId 12) is filtered out; primary-position ones kept in order
    expect(result.alternatives.map((a) => a.sofifaId)).toEqual([11, 13])
    expect(result.alternatives[0]).toMatchObject({ name: 'Alt One', ovr: 84, position: 'ATA' })
  })

  it('caps alternatives at the target market value when budget is null', async () => {
    mockedPrisma.save.findFirst.mockResolvedValue({
      id: 's1',
      budget: null,
      clubStints: [{ id: 'cs1', club: 'X' }],
    })
    mockedPrisma.fc26Player.findUnique.mockResolvedValue({
      sofifaId: 5,
      name: 'Target',
      positions: ['ZAG'],
      ovr: 85,
      potential: 87,
      age: 26,
      marketValue: 40,
      club: 'Other FC',
    })
    mockedPrisma.player.findMany.mockResolvedValue([])

    await evaluateSigningFit('user-1', 's1', 5)

    const where = mockedPrisma.fc26Player.findMany.mock.calls[0][0].where
    expect(where.marketValue).toEqual({ not: null, lte: 40 })
  })
})
