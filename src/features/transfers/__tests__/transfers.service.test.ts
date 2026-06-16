import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TransferType, PlayerStatus } from '@prisma/client'

const txMock = {
  save: { update: vi.fn() },
  player: { update: vi.fn() },
  transfer: { delete: vi.fn() },
}

vi.mock('../../../shared/lib/prisma.js', () => ({
  prisma: {
    transfer: { findFirst: vi.fn() },
    save: { findUnique: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock)),
  },
}))

vi.mock('../../saves/snapshots.service.js', () => ({
  createSnapshot: vi.fn(),
  writeAudit: vi.fn(),
}))

vi.mock('../../../shared/utils/cache.js', () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheInvalidate: vi.fn(),
}))

import { prisma } from '../../../shared/lib/prisma.js'
import { createSnapshot, writeAudit } from '../../saves/snapshots.service.js'
import { reverseTransfer } from '../transfers.service.js'

const mockedPrisma = prisma as unknown as {
  transfer: { findFirst: ReturnType<typeof vi.fn> }
  save: { findUnique: ReturnType<typeof vi.fn> }
}
const mockedCreateSnapshot = createSnapshot as unknown as ReturnType<typeof vi.fn>
const mockedWriteAudit = writeAudit as unknown as ReturnType<typeof vi.fn>

const SAVE_ID = 'save-1'
const TID = 'transfer-1'
const STINT_ID = 'stint-1'
const PLAYER_ID = 'player-1'

function mockSave(balance: number) {
  mockedPrisma.save.findUnique.mockResolvedValue({
    id: SAVE_ID,
    balance,
    clubStints: [{ id: STINT_ID }],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('reverseTransfer', () => {
  it('reverses a sale: gives the player back to the squad and removes the received fee', async () => {
    mockedPrisma.transfer.findFirst.mockResolvedValue({
      id: TID, saveId: SAVE_ID, type: TransferType.venda, fee: 30, clubStintId: STINT_ID, playerId: PLAYER_ID, playerName: 'X',
    })
    mockSave(100)

    const result = await reverseTransfer(SAVE_ID, TID, 'owner')

    // saldo: 100 - 30 (remove o dinheiro recebido na venda)
    expect(txMock.save.update).toHaveBeenCalledWith({ where: { id: SAVE_ID }, data: { balance: 70 } })
    // jogador volta ao elenco no stint de onde saiu
    expect(txMock.player.update).toHaveBeenCalledWith({
      where: { id: PLAYER_ID },
      data: { activeClubStintId: STINT_ID, status: PlayerStatus.Role },
    })
    expect(txMock.transfer.delete).toHaveBeenCalledWith({ where: { id: TID } })
    expect(result).toEqual({ reversed: true })
  })

  it('reverses a purchase: refunds the fee and removes the player from the squad', async () => {
    mockedPrisma.transfer.findFirst.mockResolvedValue({
      id: TID, saveId: SAVE_ID, type: TransferType.compra, fee: 45, clubStintId: STINT_ID, playerId: PLAYER_ID, playerName: 'Y',
    })
    mockSave(100)

    await reverseTransfer(SAVE_ID, TID, 'owner')

    // saldo: 100 + 45 (devolve o que foi gasto na compra)
    expect(txMock.save.update).toHaveBeenCalledWith({ where: { id: SAVE_ID }, data: { balance: 145 } })
    expect(txMock.player.update).toHaveBeenCalledWith({
      where: { id: PLAYER_ID },
      data: { activeClubStintId: null },
    })
  })

  it('reverses a loan-out without touching the balance and re-adds the player', async () => {
    mockedPrisma.transfer.findFirst.mockResolvedValue({
      id: TID, saveId: SAVE_ID, type: TransferType.emprestimo_saida, fee: null, clubStintId: STINT_ID, playerId: PLAYER_ID, playerName: 'Z',
    })
    mockSave(100)

    await reverseTransfer(SAVE_ID, TID, 'owner')

    expect(txMock.save.update).not.toHaveBeenCalled()
    expect(txMock.player.update).toHaveBeenCalledWith({
      where: { id: PLAYER_ID },
      data: { activeClubStintId: STINT_ID, status: PlayerStatus.Role },
    })
    expect(txMock.transfer.delete).toHaveBeenCalled()
  })

  it('always takes a safety snapshot and writes an audit row before reverting', async () => {
    mockedPrisma.transfer.findFirst.mockResolvedValue({
      id: TID, saveId: SAVE_ID, type: TransferType.venda, fee: 10, clubStintId: STINT_ID, playerId: PLAYER_ID, playerName: 'X',
    })
    mockSave(50)

    await reverseTransfer(SAVE_ID, TID, 'owner')

    expect(mockedCreateSnapshot).toHaveBeenCalledWith(txMock, SAVE_ID, 'owner', 'pre-transfer-reverse')
    expect(mockedWriteAudit).toHaveBeenCalledWith(txMock, expect.objectContaining({ action: 'transfer.reverse' }))
  })

  it('throws 404 when the transfer does not exist in the save', async () => {
    mockedPrisma.transfer.findFirst.mockResolvedValue(null)

    await expect(reverseTransfer(SAVE_ID, TID, 'owner')).rejects.toMatchObject({ statusCode: 404 })
  })
})
