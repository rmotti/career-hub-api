import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Position, PlayerStatus } from '@prisma/client'

const txMock = {
  player: { create: vi.fn(), update: vi.fn() },
  playerSeasonStats: { create: vi.fn(), createMany: vi.fn() },
}

vi.mock('../../../shared/lib/prisma.js', () => ({
  prisma: {
    save: { findUnique: vi.fn() },
    player: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    playerSeasonStats: { update: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    transfer: { findFirst: vi.fn() },
    loanSpellStats: { findMany: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock)),
  },
}))

vi.mock('../../../shared/utils/cache.js', () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheInvalidate: vi.fn(),
  cacheInvalidatePattern: vi.fn(),
}))

vi.mock('../../saves/snapshots.service.js', () => ({
  createSnapshot: vi.fn(),
  writeAudit: vi.fn(),
}))

import { prisma } from '../../../shared/lib/prisma.js'
import { cacheGet } from '../../../shared/utils/cache.js'
import { writeAudit } from '../../saves/snapshots.service.js'
import { createPlayer, updatePlayer, recallLoanedPlayer, getLoanSpellStats, upsertLoanSpellStats, getPlayerById, listPlayers } from '../players.service.js'

const mockedPrisma = prisma as unknown as {
  save: { findUnique: ReturnType<typeof vi.fn> }
  player: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
  playerSeasonStats: { findMany: ReturnType<typeof vi.fn>; groupBy: ReturnType<typeof vi.fn> }
  transfer: { findFirst: ReturnType<typeof vi.fn> }
  loanSpellStats: { findMany: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> }
  $transaction: ReturnType<typeof vi.fn>
}
const mockedCacheGet = cacheGet as unknown as ReturnType<typeof vi.fn>
const mockedWriteAudit = writeAudit as unknown as ReturnType<typeof vi.fn>

const SAVE_ID = 'save-1'
const STINT_ID = 'stint-1'
const PLAYER_ID = 'player-1'

function mockSaveWithStint() {
  mockedPrisma.save.findUnique.mockResolvedValue({
    id: SAVE_ID,
    currentSeason: '2025/26',
    clubStints: [{ id: STINT_ID }],
  })
}

const baseNewPlayer = {
  name: 'Novato',
  position: Position.MEI,
  age: 22,
  status: PlayerStatus.Role,
  ovr: 75,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createPlayer — shirt-number conflict', () => {
  it('409 SHIRT_NUMBER_CONFLICT when another active player already wears the number', async () => {
    mockSaveWithStint()
    mockedPrisma.player.findFirst.mockResolvedValue({ id: 'rival', name: 'Rival' })

    await expect(
      createPlayer(SAVE_ID, { ...baseNewPlayer, shirtNumber: 10 }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SHIRT_NUMBER_CONFLICT' })
    // não deve nem abrir transação de criação
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('only counts active-squad players as conflicts (activeClubStintId not null)', async () => {
    mockSaveWithStint()
    mockedPrisma.player.findFirst.mockResolvedValue(null)
    txMock.player.create.mockResolvedValue({ id: 'p-new', marketValue: null, salary: null })

    await createPlayer(SAVE_ID, { ...baseNewPlayer, shirtNumber: 10 })

    expect(mockedPrisma.player.findFirst).toHaveBeenCalledWith({
      where: { saveId: SAVE_ID, shirtNumber: 10, activeClubStintId: { not: null } },
    })
  })

  it.each([0, 100])('rejects out-of-range shirt number %i with 400 and never checks for conflicts', async (shirt) => {
    mockSaveWithStint()

    await expect(
      createPlayer(SAVE_ID, { ...baseNewPlayer, shirtNumber: shirt }),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(mockedPrisma.player.findFirst).not.toHaveBeenCalled()
  })

  it('creates the player and seeds PlayerSeasonStats when the number is free', async () => {
    mockSaveWithStint()
    mockedPrisma.player.findFirst.mockResolvedValue(null)
    txMock.player.create.mockResolvedValue({ id: 'p-new', marketValue: null, salary: null })

    const result = await createPlayer(SAVE_ID, { ...baseNewPlayer, shirtNumber: 7, matches: 3 })

    expect(txMock.player.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ saveId: SAVE_ID, shirtNumber: 7, activeClubStintId: STINT_ID }),
    }))
    expect(txMock.playerSeasonStats.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ playerId: 'p-new', clubStintId: STINT_ID, season: '2025/26', matches: 3 }),
    }))
    expect(result).toHaveProperty('marketValueFormatted')
  })

  it('404 when the save does not exist', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue(null)

    await expect(
      createPlayer(SAVE_ID, { ...baseNewPlayer, shirtNumber: 7 }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejects potential outside 40–99 with 400', async () => {
    mockSaveWithStint()

    await expect(
      createPlayer(SAVE_ID, { ...baseNewPlayer, potential: 39 }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('updatePlayer — shirt-number conflict', () => {
  it('409 when a DIFFERENT active player holds the number', async () => {
    mockedPrisma.player.findFirst
      .mockResolvedValueOnce({ id: PLAYER_ID, saveId: SAVE_ID, position: Position.MEI, alternativePosition: null }) // load
      .mockResolvedValueOnce({ id: 'rival', name: 'Rival' }) // conflict

    await expect(
      updatePlayer(SAVE_ID, PLAYER_ID, { shirtNumber: 10 }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SHIRT_NUMBER_CONFLICT' })
  })

  it('excludes the player itself from the conflict check (re-saving its own number is fine)', async () => {
    mockedPrisma.player.findFirst
      .mockResolvedValueOnce({ id: PLAYER_ID, saveId: SAVE_ID, position: Position.MEI, alternativePosition: null }) // load
      .mockResolvedValueOnce(null) // ninguém mais usa
    mockedPrisma.player.update.mockResolvedValue({ id: PLAYER_ID, marketValue: null, salary: null })

    await updatePlayer(SAVE_ID, PLAYER_ID, { shirtNumber: 10 })

    // a checagem de conflito exclui o próprio jogador
    expect(mockedPrisma.player.findFirst).toHaveBeenLastCalledWith({
      where: { saveId: SAVE_ID, shirtNumber: 10, activeClubStintId: { not: null }, id: { not: PLAYER_ID } },
    })
    expect(mockedPrisma.player.update).toHaveBeenCalled()
  })

  it('rejects out-of-range shirt number with 400 (no conflict query)', async () => {
    mockedPrisma.player.findFirst.mockResolvedValueOnce({ id: PLAYER_ID, saveId: SAVE_ID, position: Position.MEI, alternativePosition: null })

    await expect(
      updatePlayer(SAVE_ID, PLAYER_ID, { shirtNumber: 100 }),
    ).rejects.toMatchObject({ statusCode: 400 })
    // só a query de carregamento do jogador rodou, não a de conflito
    expect(mockedPrisma.player.findFirst).toHaveBeenCalledTimes(1)
  })

  it('404 when the player does not exist in the save', async () => {
    mockedPrisma.player.findFirst.mockResolvedValueOnce(null)

    await expect(
      updatePlayer(SAVE_ID, PLAYER_ID, { shirtNumber: 10 }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('recallLoanedPlayer (F-002)', () => {
  function mockLoanedPlayer(overrides: Record<string, unknown> = {}) {
    mockedPrisma.player.findFirst.mockResolvedValue({
      id: PLAYER_ID, name: 'Emprestado', saveId: SAVE_ID,
      status: PlayerStatus.Loan, activeClubStintId: null,
      marketValue: null, salary: null,
      ...overrides,
    })
  }

  it('re-attaches a loaned-out player to the current stint, seeds his season stats, and audits', async () => {
    mockSaveWithStint()
    mockLoanedPlayer()
    mockedPrisma.transfer.findFirst.mockResolvedValue({ id: 'tr-1' })
    txMock.player.update.mockResolvedValue({
      id: PLAYER_ID, name: 'Emprestado', activeClubStintId: STINT_ID, status: PlayerStatus.Role,
      marketValue: null, salary: null,
    })

    const result = await recallLoanedPlayer(SAVE_ID, PLAYER_ID, 'owner')

    expect(txMock.player.update).toHaveBeenCalledWith({
      where: { id: PLAYER_ID },
      data: { activeClubStintId: STINT_ID, status: PlayerStatus.Role },
    })
    expect(txMock.playerSeasonStats.createMany).toHaveBeenCalledWith({
      data: [{ playerId: PLAYER_ID, clubStintId: STINT_ID, season: '2025/26' }],
      skipDuplicates: true,
    })
    expect(mockedWriteAudit).toHaveBeenCalledWith(txMock, expect.objectContaining({ action: 'player.loan_recall' }))
    expect(result).toMatchObject({ activeClubStintId: STINT_ID, status: PlayerStatus.Role })
  })

  it('does NOT touch the player age on recall (aging only happens on season advance)', async () => {
    mockSaveWithStint()
    mockLoanedPlayer()
    mockedPrisma.transfer.findFirst.mockResolvedValue({ id: 'tr-1' })
    txMock.player.update.mockResolvedValue({ id: PLAYER_ID, marketValue: null, salary: null })

    await recallLoanedPlayer(SAVE_ID, PLAYER_ID, 'owner')

    const updateArg = txMock.player.update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateArg.data).not.toHaveProperty('age')
  })

  it('400 when the player is not on loan (already in the active squad), opening no transaction', async () => {
    mockSaveWithStint()
    mockLoanedPlayer({ status: PlayerStatus.Role, activeClubStintId: STINT_ID })

    await expect(recallLoanedPlayer(SAVE_ID, PLAYER_ID, 'owner')).rejects.toMatchObject({ statusCode: 400 })
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('400 when the loan was not from the current club (no matching emprestimo_saida transfer)', async () => {
    mockSaveWithStint()
    mockLoanedPlayer()
    mockedPrisma.transfer.findFirst.mockResolvedValue(null)

    await expect(recallLoanedPlayer(SAVE_ID, PLAYER_ID, 'owner')).rejects.toMatchObject({ statusCode: 400 })
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('404 when the save has no active club stint', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, currentSeason: '2025/26', clubStints: [] })
    mockLoanedPlayer()

    await expect(recallLoanedPlayer(SAVE_ID, PLAYER_ID, 'owner')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('loan-spell stats (B-001)', () => {
  it('getLoanSpellStats returns rows with goalContributions', async () => {
    mockedPrisma.player.findFirst.mockResolvedValue({ id: PLAYER_ID })
    mockedPrisma.loanSpellStats.findMany.mockResolvedValue([
      { id: 'ls-1', playerId: PLAYER_ID, season: '2025/26', goals: 3, assists: 2, matches: 10 },
    ])

    const result = await getLoanSpellStats(SAVE_ID, PLAYER_ID) as Array<{ goalContributions: number }>

    expect(mockedPrisma.loanSpellStats.findMany).toHaveBeenCalledWith({
      where: { saveId: SAVE_ID, playerId: PLAYER_ID },
      orderBy: { season: 'asc' },
    })
    expect(result[0].goalContributions).toBe(5)
  })

  it('upsertLoanSpellStats writes the current loan season when the player is out on loan', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, currentSeason: '2025/26', clubStints: [{ id: STINT_ID }] })
    mockedPrisma.player.findFirst.mockResolvedValue({ id: PLAYER_ID, name: 'Cedido', status: PlayerStatus.Loan, activeClubStintId: null })
    mockedPrisma.transfer.findFirst.mockResolvedValue({ id: 'tr-1', to: 'Loan FC' })
    mockedPrisma.loanSpellStats.upsert.mockResolvedValue({ id: 'ls-1', goals: 4, assists: 1, matches: 8 })

    const result = await upsertLoanSpellStats(SAVE_ID, PLAYER_ID, { goals: 4, assists: 1, matches: 8 }) as { goalContributions: number }

    expect(mockedPrisma.loanSpellStats.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { playerId_season: { playerId: PLAYER_ID, season: '2025/26' } },
      create: expect.objectContaining({ saveId: SAVE_ID, playerId: PLAYER_ID, transferId: 'tr-1', loanClub: 'Loan FC', season: '2025/26', goals: 4, assists: 1, matches: 8 }),
      update: { goals: 4, assists: 1, matches: 8 },
    }))
    expect(result.goalContributions).toBe(5)
  })

  it('upsertLoanSpellStats 400 when the player is not out on loan', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, currentSeason: '2025/26', clubStints: [{ id: STINT_ID }] })
    mockedPrisma.player.findFirst.mockResolvedValue({ id: PLAYER_ID, name: 'Titular', status: PlayerStatus.Role, activeClubStintId: STINT_ID })

    await expect(upsertLoanSpellStats(SAVE_ID, PLAYER_ID, { goals: 1 })).rejects.toMatchObject({ statusCode: 400 })
    expect(mockedPrisma.loanSpellStats.upsert).not.toHaveBeenCalled()
  })

  it('upsertLoanSpellStats 400 when the loan was not from the current club', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, currentSeason: '2025/26', clubStints: [{ id: STINT_ID }] })
    mockedPrisma.player.findFirst.mockResolvedValue({ id: PLAYER_ID, name: 'Cedido', status: PlayerStatus.Loan, activeClubStintId: null })
    mockedPrisma.transfer.findFirst.mockResolvedValue(null)

    await expect(upsertLoanSpellStats(SAVE_ID, PLAYER_ID, { goals: 1 })).rejects.toMatchObject({ statusCode: 400 })
    expect(mockedPrisma.loanSpellStats.upsert).not.toHaveBeenCalled()
  })
})

describe('getPlayerById — per-season history (F-004)', () => {
  function stat(season: string, club: string, goals: number, assists: number, matches: number) {
    return { season, goals, assists, matches, yellowCards: 0, redCards: 0, cleanSheets: 0, clubStint: { club } }
  }

  it('builds merged `seasons` (OVR/MV + per-club stats), separate `loanSpells`, and career totals', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID })
    mockedPrisma.player.findFirst.mockResolvedValue({
      id: PLAYER_ID,
      name: 'Trajetória',
      marketValue: 50,
      salary: 100,
      seasonStats: [
        // mid-season club change → two rows for 2026/27
        stat('2026/27', 'Club A', 5, 3, 18),
        stat('2026/27', 'Club B', 7, 2, 16),
        stat('2025/26', 'Club A', 10, 6, 34),
      ],
      ovrHistory: [
        { season: '2025/26', ovr: 80, marketValue: 40 },
        { season: '2026/27', ovr: 84, marketValue: 50 },
        // OVR snapshot with no stats yet → still appears in seasons
        { season: '2027/28', ovr: 86, marketValue: 60 },
      ],
      loanSpellStats: [
        { season: '2024/25', loanClub: 'Loan FC', goals: 4, assists: 1, matches: 20 },
      ],
    })

    const result = await getPlayerById(SAVE_ID, PLAYER_ID) as {
      totalStats: { goals: number; assists: number; goalContributions: number }
      seasons: Array<{ season: string; ovr: number | null; marketValue: number | null; clubs: Array<{ club: string; goalContributions: number }> }>
      loanSpells: Array<{ season: string; loanClub: string; goalContributions: number }>
    }

    // totals exclude loan-spell numbers
    expect(result.totalStats.goals).toBe(22)
    expect(result.totalStats.assists).toBe(11)
    expect(result.totalStats.goalContributions).toBe(33)

    // seasons sorted chronologically
    expect(result.seasons.map(s => s.season)).toEqual(['2025/26', '2026/27', '2027/28'])

    // multi-club season carries both clubs
    const s2627 = result.seasons.find(s => s.season === '2026/27')!
    expect(s2627.ovr).toBe(84)
    expect(s2627.clubs.map(c => c.club)).toEqual(['Club A', 'Club B'])
    expect(s2627.clubs.find(c => c.club === 'Club B')!.goalContributions).toBe(9)

    // OVR-only season has no clubs
    expect(result.seasons.find(s => s.season === '2027/28')!.clubs).toEqual([])

    // loan spells surfaced separately, never merged into seasons
    expect(result.loanSpells).toHaveLength(1)
    expect(result.loanSpells[0]).toMatchObject({ season: '2024/25', loanClub: 'Loan FC', goalContributions: 5 })
    expect(result.seasons.some(s => s.season === '2024/25')).toBe(false)
  })
})

describe('listPlayers — ranking clubs (F-003)', () => {
  type RankedPlayer = { id: string; clubs: string[]; totalStats: { goals: number } }

  beforeEach(() => {
    mockedCacheGet.mockResolvedValue(null) // force fetchPlayers (skip cache hit)
    // default list variant: current stint resolution + the three parallel queries
    mockedPrisma.save.findUnique.mockResolvedValue({
      currentSeason: '2027/28',
      clubStints: [{ id: STINT_ID, club: 'Club A' }],
    })
    mockedPrisma.playerSeasonStats.groupBy.mockResolvedValue([])
  })

  it('returns the distinct clubs each player featured for, in first-appearance order', async () => {
    mockedPrisma.player.findMany.mockResolvedValue([
      { id: 'p-multi', marketValue: null, salary: null },
      { id: 'p-repeat', marketValue: null, salary: null },
      { id: 'p-none', marketValue: null, salary: null },
    ])
    // ordered by season asc (then createdAt) — as the real query returns them
    mockedPrisma.playerSeasonStats.findMany.mockResolvedValue([
      { playerId: 'p-multi', clubStint: { club: 'Arsenal' } },   // 2025/26
      { playerId: 'p-repeat', clubStint: { club: 'Chelsea' } },  // 2025/26
      { playerId: 'p-multi', clubStint: { club: 'Chelsea' } },   // 2026/27 (club change)
      { playerId: 'p-repeat', clubStint: { club: 'Chelsea' } },  // 2026/27 (same club again)
    ])

    const result = (await listPlayers(SAVE_ID)) as RankedPlayer[]
    const byId = new Map(result.map((p) => [p.id, p]))

    // two distinct clubs, chronological order preserved
    expect(byId.get('p-multi')!.clubs).toEqual(['Arsenal', 'Chelsea'])
    // same club across two seasons collapses to a single entry
    expect(byId.get('p-repeat')!.clubs).toEqual(['Chelsea'])
    // player with no season stats has an empty clubs list
    expect(byId.get('p-none')!.clubs).toEqual([])
  })
})
