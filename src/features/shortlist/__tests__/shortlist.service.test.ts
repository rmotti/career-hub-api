import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../shared/lib/prisma.js', () => ({
  prisma: {
    save: { findFirst: vi.fn() },
    shortlistItem: { findMany: vi.fn() },
    clubStint: { findFirst: vi.fn() },
    scoutPlaybook: { findFirst: vi.fn() },
  },
}))

vi.mock('../../fc26-players/fc26-players.service.js', () => ({
  computeFitScoreMap: vi.fn(),
}))

import { prisma } from '../../../shared/lib/prisma.js'
import { computeFitScoreMap } from '../../fc26-players/fc26-players.service.js'
import { listShortlist } from '../shortlist.service.js'

const mockedPrisma = prisma as unknown as {
  save: { findFirst: ReturnType<typeof vi.fn> }
  shortlistItem: { findMany: ReturnType<typeof vi.fn> }
  clubStint: { findFirst: ReturnType<typeof vi.fn> }
  scoutPlaybook: { findFirst: ReturnType<typeof vi.fn> }
}

function shortlistItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    saveId: 's1',
    fc26PlayerId: 10,
    notes: null,
    priority: null,
    fc26Player: { sofifaId: 1001, age: 22, nation: 'BR', league: 'BRA', marketValue: 30, positions: ['ATA'] },
    ...overrides,
  }
}

beforeEach(() => {
  mockedPrisma.save.findFirst.mockReset().mockResolvedValue({ id: 's1' }) // assertSaveAccess passes
  mockedPrisma.shortlistItem.findMany.mockReset()
  mockedPrisma.clubStint.findFirst.mockReset()
  mockedPrisma.scoutPlaybook.findFirst.mockReset()
  vi.mocked(computeFitScoreMap).mockReset()
})

describe('listShortlist — fit-score enrichment', () => {
  it('attaches fitScore/fitConfidence from the save active club + default playbook objective', async () => {
    mockedPrisma.shortlistItem.findMany.mockResolvedValue([shortlistItem()])
    mockedPrisma.clubStint.findFirst.mockResolvedValue({ club: 'Flamengo' })
    mockedPrisma.scoutPlaybook.findFirst.mockResolvedValue({ preferences: { objective: 'title' } })
    vi.mocked(computeFitScoreMap).mockResolvedValue(
      new Map([[1001, { fit_score: 87, confidence: 'high', profile_size: 12 }]]) as never,
    )

    const items = await listShortlist('s1', 'u1')

    expect(vi.mocked(computeFitScoreMap)).toHaveBeenCalledWith(expect.anything(), 'Flamengo', 'title')
    expect(items[0].fc26Player).toMatchObject({ fitScore: 87, fitConfidence: 'high', fitProfileSize: 12 })
  })

  it('defaults the objective to "balanced" when the save has no default playbook', async () => {
    mockedPrisma.shortlistItem.findMany.mockResolvedValue([shortlistItem()])
    mockedPrisma.clubStint.findFirst.mockResolvedValue({ club: 'Flamengo' })
    mockedPrisma.scoutPlaybook.findFirst.mockResolvedValue(null)
    vi.mocked(computeFitScoreMap).mockResolvedValue(new Map() as never)

    await listShortlist('s1', 'u1')

    expect(vi.mocked(computeFitScoreMap)).toHaveBeenCalledWith(expect.anything(), 'Flamengo', 'balanced')
  })

  it('fails open with null fit fields when the save has no active club (no fit-score call)', async () => {
    mockedPrisma.shortlistItem.findMany.mockResolvedValue([shortlistItem()])
    mockedPrisma.clubStint.findFirst.mockResolvedValue(null)

    const items = await listShortlist('s1', 'u1')

    expect(vi.mocked(computeFitScoreMap)).not.toHaveBeenCalled()
    expect(items[0].fc26Player).toMatchObject({ fitScore: null, fitConfidence: null, fitProfileSize: null })
  })

  it('leaves fit fields null for players the fit-score service did not score', async () => {
    mockedPrisma.shortlistItem.findMany.mockResolvedValue([shortlistItem()])
    mockedPrisma.clubStint.findFirst.mockResolvedValue({ club: 'Flamengo' })
    mockedPrisma.scoutPlaybook.findFirst.mockResolvedValue(null)
    vi.mocked(computeFitScoreMap).mockResolvedValue(new Map() as never) // service returned nothing

    const items = await listShortlist('s1', 'u1')

    expect(items[0].fc26Player).toMatchObject({ fitScore: null, fitConfidence: null, fitProfileSize: null })
  })

  it('short-circuits an empty shortlist without touching the club/playbook lookups', async () => {
    mockedPrisma.shortlistItem.findMany.mockResolvedValue([])

    const items = await listShortlist('s1', 'u1')

    expect(items).toEqual([])
    expect(mockedPrisma.clubStint.findFirst).not.toHaveBeenCalled()
    expect(vi.mocked(computeFitScoreMap)).not.toHaveBeenCalled()
  })
})
