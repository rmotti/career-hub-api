import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../shared/lib/prisma.js', () => ({
  prisma: {
    save: { findFirst: vi.fn() },
    player: { findMany: vi.fn() },
    fc26Player: { findUnique: vi.fn() },
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
  fc26Player: { findUnique: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  mockedPrisma.save.findFirst.mockReset()
  mockedPrisma.player.findMany.mockReset()
  mockedPrisma.fc26Player.findUnique.mockReset()
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
})
