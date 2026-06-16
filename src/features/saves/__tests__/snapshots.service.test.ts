import { beforeEach, describe, expect, it, vi } from 'vitest'

// tx client with every model restoreSnapshot touches (deleteMany + createMany), plus save.update / auditLog.create.
const txMock = {
  playerOvrHistory: { deleteMany: vi.fn(), createMany: vi.fn() },
  playerSeasonStats: { deleteMany: vi.fn(), createMany: vi.fn() },
  trophy: { deleteMany: vi.fn(), createMany: vi.fn() },
  teamSeasonStats: { deleteMany: vi.fn(), createMany: vi.fn() },
  transfer: { deleteMany: vi.fn(), createMany: vi.fn() },
  player: { deleteMany: vi.fn(), createMany: vi.fn() },
  shortlistItem: { deleteMany: vi.fn(), createMany: vi.fn() },
  savedSearch: { deleteMany: vi.fn(), createMany: vi.fn() },
  scoutPlaybook: { deleteMany: vi.fn(), createMany: vi.fn() },
  clubStint: { deleteMany: vi.fn(), createMany: vi.fn() },
  save: { update: vi.fn() },
  auditLog: { create: vi.fn() },
}

vi.mock('../../../shared/lib/prisma.js', () => ({
  prisma: {
    save: { findUnique: vi.fn() },
    saveSnapshot: { findUnique: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock)),
  },
}))

vi.mock('../../../shared/utils/cache.js', () => ({
  cacheInvalidate: vi.fn(),
  cacheInvalidatePattern: vi.fn(),
}))

import { prisma } from '../../../shared/lib/prisma.js'
import { restoreSnapshot } from '../snapshots.service.js'

const mockedPrisma = prisma as unknown as {
  save: { findUnique: ReturnType<typeof vi.fn> }
  saveSnapshot: { findUnique: ReturnType<typeof vi.fn> }
}

const SAVE_ID = 'save-1'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('restoreSnapshot — legacy cup columns tolerance', () => {
  it('strips europeanCupResult/nationalCupResult from a pre-migration snapshot payload', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ userId: 'owner' })
    mockedPrisma.saveSnapshot.findUnique.mockResolvedValue({
      id: 'snap-1',
      saveId: SAVE_ID,
      reason: 'manual',
      payload: {
        version: 1,
        save: { name: 'x', currentYear: 2025, currentSeason: '2025/26', budget: 100, balance: 50 },
        clubStints: [],
        players: [],
        transfers: [],
        teamSeasonStats: [
          {
            id: 't1',
            clubStintId: 'st1',
            season: '2025/26',
            goalsPro: 0, goalsAgainst: 0, wins: 0, draws: 0, losses: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            leaguePosition: 1,
            competitionId: 'c1',
            cupResult: 'Campeao',
            // legacy columns dropped by the migration — must not reach createMany
            europeanCupResult: 'NaoParticipou',
            nationalCupResult: 'Final',
          },
        ],
        playerSeasonStats: [],
        trophies: [],
        playerOvrHistory: [],
        scoutPlaybooks: [],
        shortlistItems: [],
        savedSearches: [],
      },
    })

    await restoreSnapshot(SAVE_ID, 'snap-1', 'owner')

    expect(txMock.teamSeasonStats.createMany).toHaveBeenCalledTimes(1)
    const row = txMock.teamSeasonStats.createMany.mock.calls[0][0].data[0]
    expect(row).not.toHaveProperty('europeanCupResult')
    expect(row).not.toHaveProperty('nationalCupResult')
    expect(row).toMatchObject({ id: 't1', competitionId: 'c1', cupResult: 'Campeao', leaguePosition: 1 })
  })
})
