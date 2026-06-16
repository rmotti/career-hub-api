import { beforeEach, describe, expect, it, vi } from 'vitest'

const txMock = {
  competition: { findMany: vi.fn().mockResolvedValue([]) },
  teamSeasonStats: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
  clubStint: { update: vi.fn(), create: vi.fn().mockResolvedValue({ id: 'new-stint' }) },
  player: { updateMany: vi.fn() },
}

vi.mock('../../../shared/lib/prisma.js', () => ({
  prisma: {
    save: { findUnique: vi.fn() },
    clubStint: { findFirst: vi.fn() },
    competition: { findFirst: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock)),
  },
}))

vi.mock('../../clubs/clubs.service.js', () => ({
  clubExists: () => true,
  findLeagueByClub: () => null,
  LEAGUE_TO_COUNTRY: {},
}))

vi.mock('../../saves/snapshots.service.js', () => ({
  createSnapshot: vi.fn(),
  writeAudit: vi.fn(),
}))

vi.mock('../../../shared/utils/cache.js', () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheInvalidate: vi.fn(),
  cacheInvalidatePattern: vi.fn(),
}))

import { prisma } from '../../../shared/lib/prisma.js'
import { createSnapshot, writeAudit } from '../../saves/snapshots.service.js'
import { createClubStint } from '../club-stints.service.js'

const mockedPrisma = prisma as unknown as {
  save: { findUnique: ReturnType<typeof vi.fn> }
  clubStint: { findFirst: ReturnType<typeof vi.fn> }
}
const mockedCreateSnapshot = createSnapshot as unknown as ReturnType<typeof vi.fn>
const mockedWriteAudit = writeAudit as unknown as ReturnType<typeof vi.fn>

const SAVE_ID = 'save-1'

beforeEach(() => {
  vi.clearAllMocks()
  txMock.clubStint.create.mockResolvedValue({ id: 'new-stint' })
})

describe('createClubStint safety net', () => {
  it('snapshots and audits before changing clubs (so the squad detach is recoverable)', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, currentSeason: '2027/28', currentYear: 2027 })
    mockedPrisma.clubStint.findFirst.mockResolvedValue({ id: 'old-stint', club: 'Old FC' })

    await createClubStint(SAVE_ID, { club: 'New FC' }, 'owner')

    expect(mockedCreateSnapshot).toHaveBeenCalledWith(txMock, SAVE_ID, 'owner', 'pre-club-change')
    expect(mockedWriteAudit).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({ action: 'clubstint.change', meta: expect.objectContaining({ from: 'Old FC', to: 'New FC' }) }),
    )
    // the destructive squad detach still runs
    expect(txMock.player.updateMany).toHaveBeenCalled()
  })
})
