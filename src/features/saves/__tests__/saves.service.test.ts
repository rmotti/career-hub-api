import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayerStatus } from '@prisma/client'

const txMock = {
  save: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  clubStint: { create: vi.fn() },
  teamSeasonStats: { findMany: vi.fn(), createMany: vi.fn() },
  trophy: { upsert: vi.fn() },
  player: { findMany: vi.fn(), updateMany: vi.fn() },
  playerOvrHistory: { createMany: vi.fn() },
  playerSeasonStats: { createMany: vi.fn() },
}

vi.mock('../../../shared/lib/prisma.js', () => ({
  prisma: {
    save: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock)),
  },
}))

vi.mock('../../clubs/clubs.service.js', () => ({
  clubExists: vi.fn(),
  findLeagueByClub: vi.fn(),
  LEAGUE_TO_COUNTRY: { 'Premier League': 'England' },
}))

vi.mock('../../competitions/competitions.service.js', () => ({
  getCompetitionIdsByCountry: vi.fn(),
}))

vi.mock('../snapshots.service.js', () => ({
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
import { createSnapshot, writeAudit } from '../snapshots.service.js'
import { clubExists, findLeagueByClub } from '../../clubs/clubs.service.js'
import { getCompetitionIdsByCountry } from '../../competitions/competitions.service.js'
import { createSave, updateSave, deleteSave, restoreSave } from '../saves.service.js'

const mockedPrisma = prisma as unknown as {
  save: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }
  $transaction: ReturnType<typeof vi.fn>
}
const mockedClubExists = clubExists as unknown as ReturnType<typeof vi.fn>
const mockedFindLeague = findLeagueByClub as unknown as ReturnType<typeof vi.fn>
const mockedGetComps = getCompetitionIdsByCountry as unknown as ReturnType<typeof vi.fn>
const mockedCreateSnapshot = createSnapshot as unknown as ReturnType<typeof vi.fn>
const mockedWriteAudit = writeAudit as unknown as ReturnType<typeof vi.fn>

const SAVE_ID = 'save-1'
const STINT_ID = 'stint-1'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('deleteSave', () => {
  it('requires ?confirm=<saveId> — throws 400 and mutates nothing', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, userId: 'owner', deletedAt: null, name: 'x' })

    await expect(deleteSave(SAVE_ID, 'owner', { confirm: 'wrong' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'DELETE_CONFIRMATION_REQUIRED',
    })
    expect(txMock.save.update).not.toHaveBeenCalled()
    expect(txMock.save.delete).not.toHaveBeenCalled()
    expect(mockedCreateSnapshot).not.toHaveBeenCalled()
  })

  it('soft-deletes by default: takes a pre-delete snapshot and sets deletedAt', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, userId: 'owner', deletedAt: null, name: 'x' })

    const result = await deleteSave(SAVE_ID, 'owner', { confirm: SAVE_ID })

    expect(mockedCreateSnapshot).toHaveBeenCalledWith(txMock, SAVE_ID, 'owner', 'pre-delete')
    expect(txMock.save.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SAVE_ID }, data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    )
    expect(txMock.save.delete).not.toHaveBeenCalled()
    expect(result).toEqual({ purged: false })
  })

  it('purges with ?purge=true: hard-deletes and audits, no snapshot', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, userId: 'owner', deletedAt: null, name: 'x' })

    const result = await deleteSave(SAVE_ID, 'owner', { confirm: SAVE_ID, purge: true })

    expect(txMock.save.delete).toHaveBeenCalledWith({ where: { id: SAVE_ID } })
    expect(mockedWriteAudit).toHaveBeenCalledWith(txMock, expect.objectContaining({ action: 'save.purge' }))
    expect(mockedCreateSnapshot).not.toHaveBeenCalled()
    expect(result).toEqual({ purged: true })
  })

  it('is idempotent on an already-archived save (no second snapshot)', async () => {
    const deletedAt = new Date()
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, userId: 'owner', deletedAt, name: 'x' })

    const result = await deleteSave(SAVE_ID, 'owner', { confirm: SAVE_ID })

    expect(result).toEqual({ purged: false, deletedAt })
    expect(mockedCreateSnapshot).not.toHaveBeenCalled()
    expect(txMock.save.update).not.toHaveBeenCalled()
  })

  it('blocks IDOR: 404 when the save belongs to another user (before the confirm check)', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, userId: 'owner', deletedAt: null, name: 'x' })

    await expect(deleteSave(SAVE_ID, 'attacker', { confirm: SAVE_ID })).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('restoreSave', () => {
  it('un-archives a soft-deleted save (clears deletedAt) + audits', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, userId: 'owner', deletedAt: new Date() })

    await restoreSave(SAVE_ID, 'owner')

    expect(txMock.save.update).toHaveBeenCalledWith({ where: { id: SAVE_ID }, data: { deletedAt: null } })
    expect(mockedWriteAudit).toHaveBeenCalledWith(txMock, expect.objectContaining({ action: 'save.restore' }))
  })

  it('rejects with 400 when the save is not archived', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, userId: 'owner', deletedAt: null })

    await expect(restoreSave(SAVE_ID, 'owner')).rejects.toMatchObject({ statusCode: 400 })
    expect(txMock.save.update).not.toHaveBeenCalled()
  })

  it('blocks IDOR: 404 for a save owned by someone else', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, userId: 'owner', deletedAt: new Date() })

    await expect(restoreSave(SAVE_ID, 'attacker')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('createSave (creation cascade)', () => {
  it('rejects an unknown club with 400 and never opens a transaction', async () => {
    mockedClubExists.mockReturnValue(false)

    await expect(
      createSave({ name: 'S', club: 'Fake FC', budget: 100, userId: 'owner' }),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('cascades save → clubStint → one TeamSeasonStats per competition, balance seeded from budget', async () => {
    mockedClubExists.mockReturnValue(true)
    mockedFindLeague.mockReturnValue('Premier League')
    mockedGetComps.mockResolvedValue(['comp-1', 'comp-2'])
    txMock.save.create.mockResolvedValue({ id: SAVE_ID, name: 'S', userId: 'owner', budget: 100, balance: 100, currentSeason: '2025/26', currentYear: 2025 })
    txMock.clubStint.create.mockResolvedValue({ id: STINT_ID, club: 'Man City', isCurrent: true })

    const result = await createSave({ name: 'S', club: 'Man City', budget: 100, userId: 'owner' })

    expect(txMock.save.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'owner', budget: 100, balance: 100, currentSeason: '2025/26', currentYear: 2025 }),
    }))
    expect(txMock.clubStint.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ saveId: SAVE_ID, club: 'Man City', isCurrent: true }),
    }))
    // cascade: uma TeamSeasonStats por competição do país
    expect(txMock.teamSeasonStats.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [
        { clubStintId: STINT_ID, season: '2025/26', competitionId: 'comp-1' },
        { clubStintId: STINT_ID, season: '2025/26', competitionId: 'comp-2' },
      ],
      skipDuplicates: true,
    }))
    expect(result.balance).toBe(100)
    expect(result.currentClubStint).toEqual(expect.objectContaining({ id: STINT_ID }))
  })

  it('appends the optional european competition to the cascade', async () => {
    mockedClubExists.mockReturnValue(true)
    mockedFindLeague.mockReturnValue('Premier League')
    mockedGetComps.mockResolvedValue(['comp-1'])
    txMock.save.create.mockResolvedValue({ id: SAVE_ID, budget: 100, balance: 100 })
    txMock.clubStint.create.mockResolvedValue({ id: STINT_ID })

    await createSave({ name: 'S', club: 'Man City', budget: 100, userId: 'owner', europeanCompetitionId: 'ucl' })

    expect(txMock.teamSeasonStats.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [
        { clubStintId: STINT_ID, season: '2025/26', competitionId: 'comp-1' },
        { clubStintId: STINT_ID, season: '2025/26', competitionId: 'ucl' },
      ],
      skipDuplicates: true,
    }))
  })

  it('skips TeamSeasonStats when the club maps to no competitions', async () => {
    mockedClubExists.mockReturnValue(true)
    mockedFindLeague.mockReturnValue(null) // país desconhecido → sem competições
    txMock.save.create.mockResolvedValue({ id: SAVE_ID, budget: 50, balance: 50 })
    txMock.clubStint.create.mockResolvedValue({ id: STINT_ID })

    await createSave({ name: 'S', club: 'Unknown FC', budget: 50, userId: 'owner' })

    expect(txMock.teamSeasonStats.createMany).not.toHaveBeenCalled()
  })
})

// Save carregado por updateSave (include clubStints isCurrent → teamSeasonStats).
function mockSaveForUpdate(overrides: Record<string, unknown> = {}) {
  mockedPrisma.save.findUnique.mockResolvedValue({
    id: SAVE_ID, userId: 'owner', deletedAt: null, name: 'S',
    currentSeason: '2025/26', currentYear: 2025, budget: 200, balance: 150,
    createdAt: new Date(), updatedAt: new Date(),
    clubStints: [{ id: STINT_ID, club: 'Man City', teamSeasonStats: [{ season: '2025/26' }] }],
    ...overrides,
  })
}

describe('updateSave — season advance', () => {
  it('snapshots+audits, awards league champions, ages the squad and seeds next-season stats', async () => {
    mockSaveForUpdate()
    mockedFindLeague.mockReturnValue('Premier League')
    mockedGetComps.mockResolvedValue(['comp-1'])
    // competição encerrando: liga vencida (1º lugar) → vira troféu
    txMock.teamSeasonStats.findMany.mockResolvedValue([
      { competitionId: 'comp-1', leaguePosition: 1, cupResult: null, competition: { type: 'League' } },
    ])
    txMock.player.findMany
      .mockResolvedValueOnce([{ id: 'p1', ovr: 80, marketValue: 50 }]) // activePlayers
      .mockResolvedValueOnce([]) // loanedPlayers
    txMock.save.update.mockResolvedValue({
      id: SAVE_ID, userId: 'owner', name: 'S', currentYear: 2026, currentSeason: '2026/27',
      budget: 200, balance: 150, createdAt: new Date(), updatedAt: new Date(),
    })

    const result = await updateSave(SAVE_ID, { currentSeason: '2026/27', currentYear: 2026 }, 'owner')

    expect(mockedCreateSnapshot).toHaveBeenCalledWith(txMock, SAVE_ID, 'owner', 'pre-season-advance')
    expect(mockedWriteAudit).toHaveBeenCalledWith(txMock, expect.objectContaining({ action: 'save.season_advance' }))
    // campeão da liga → troféu com year = ano que encerra (2025)
    expect(txMock.trophy.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { clubStintId: STINT_ID, competitionId: 'comp-1', year: 2025 },
    }))
    // snapshot de OVR antes de envelhecer
    expect(txMock.playerOvrHistory.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [{ playerId: 'p1', season: '2025/26', ovr: 80, marketValue: 50 }],
      skipDuplicates: true,
    }))
    // envelhece o elenco ativo (age < 45)
    expect(txMock.player.updateMany).toHaveBeenCalledWith({
      where: { saveId: SAVE_ID, activeClubStintId: STINT_ID, age: { lt: 45 } },
      data: { age: { increment: 1 } },
    })
    // TeamSeasonStats da nova temporada
    expect(txMock.teamSeasonStats.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [{ clubStintId: STINT_ID, season: '2026/27', competitionId: 'comp-1' }],
      skipDuplicates: true,
    }))
    // PlayerSeasonStats da nova temporada para o ativo
    expect(txMock.playerSeasonStats.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [{ playerId: 'p1', clubStintId: STINT_ID, season: '2026/27' }],
      skipDuplicates: true,
    }))
    expect(result.currentSeason).toBe('2026/27')
    expect(result.availableSeasons).toContain('2026/27')
  })

  it('does NOT award a trophy when the league was not won (position 2)', async () => {
    mockSaveForUpdate()
    mockedFindLeague.mockReturnValue(null) // simplifica nova temporada
    txMock.teamSeasonStats.findMany.mockResolvedValue([
      { competitionId: 'comp-1', leaguePosition: 2, cupResult: null, competition: { type: 'League' } },
    ])
    txMock.player.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    txMock.save.update.mockResolvedValue({ id: SAVE_ID, userId: 'owner', name: 'S', currentYear: 2026, currentSeason: '2026/27', budget: 200, balance: 150, createdAt: new Date(), updatedAt: new Date() })

    await updateSave(SAVE_ID, { currentSeason: '2026/27' }, 'owner')

    expect(txMock.trophy.upsert).not.toHaveBeenCalled()
  })

  it('resets balance to budget when a budget is passed with the advance', async () => {
    mockSaveForUpdate({ balance: 10 })
    mockedFindLeague.mockReturnValue(null)
    txMock.teamSeasonStats.findMany.mockResolvedValue([])
    txMock.player.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    txMock.save.update.mockResolvedValue({ id: SAVE_ID, userId: 'owner', name: 'S', currentYear: 2026, currentSeason: '2026/27', budget: 300, balance: 300, createdAt: new Date(), updatedAt: new Date() })

    await updateSave(SAVE_ID, { currentSeason: '2026/27', budget: 300 }, 'owner')

    // saveData.balance forçado para o budget no avanço
    expect(txMock.save.update).toHaveBeenCalledWith({
      where: { id: SAVE_ID },
      data: expect.objectContaining({ currentSeason: '2026/27', budget: 300, balance: 300 }),
    })
  })

  it('returns loaned-out players to the squad on advance', async () => {
    mockSaveForUpdate()
    mockedFindLeague.mockReturnValue(null)
    txMock.teamSeasonStats.findMany.mockResolvedValue([])
    txMock.player.findMany
      .mockResolvedValueOnce([]) // activePlayers
      .mockResolvedValueOnce([{ id: 'loaned-1' }]) // loanedPlayers de volta
    txMock.save.update.mockResolvedValue({ id: SAVE_ID, userId: 'owner', name: 'S', currentYear: 2026, currentSeason: '2026/27', budget: 200, balance: 150, createdAt: new Date(), updatedAt: new Date() })

    await updateSave(SAVE_ID, { currentSeason: '2026/27' }, 'owner')

    expect(txMock.player.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['loaned-1'] } },
      data: { activeClubStintId: STINT_ID, status: PlayerStatus.Role },
    })
  })
})

describe('updateSave — non-season edits', () => {
  it('audits a direct finance edit (from→to) and takes no snapshot', async () => {
    mockSaveForUpdate()
    txMock.save.update.mockResolvedValue({ id: SAVE_ID, userId: 'owner', name: 'S', currentYear: 2025, currentSeason: '2025/26', budget: 200, balance: 500, createdAt: new Date(), updatedAt: new Date() })

    await updateSave(SAVE_ID, { balance: 500 }, 'owner')

    expect(mockedCreateSnapshot).not.toHaveBeenCalled()
    expect(mockedWriteAudit).toHaveBeenCalledWith(txMock, expect.objectContaining({
      action: 'save.finance_edit',
      meta: expect.objectContaining({ balance: { from: 150, to: 500 } }),
    }))
  })

  it('blocks IDOR: 404 when the save belongs to another user', async () => {
    mockSaveForUpdate()

    await expect(updateSave(SAVE_ID, { balance: 1 }, 'attacker')).rejects.toMatchObject({ statusCode: 404 })
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled()
  })
})
