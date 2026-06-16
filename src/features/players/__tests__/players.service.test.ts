import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Position, PlayerStatus } from '@prisma/client'

const txMock = {
  player: { create: vi.fn() },
  playerSeasonStats: { create: vi.fn() },
}

vi.mock('../../../shared/lib/prisma.js', () => ({
  prisma: {
    save: { findUnique: vi.fn() },
    player: { findFirst: vi.fn(), update: vi.fn() },
    playerSeasonStats: { update: vi.fn() },
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
import { createPlayer, updatePlayer } from '../players.service.js'

const mockedPrisma = prisma as unknown as {
  save: { findUnique: ReturnType<typeof vi.fn> }
  player: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
  $transaction: ReturnType<typeof vi.fn>
}

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
