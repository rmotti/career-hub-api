import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TransferType, PlayerStatus } from '@prisma/client'

const txMock = {
  save: { update: vi.fn() },
  player: { update: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
  playerSeasonStats: { createMany: vi.fn() },
  loanSpellStats: { create: vi.fn() },
  transfer: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
}

vi.mock('../../../shared/lib/prisma.js', () => ({
  prisma: {
    transfer: { findFirst: vi.fn() },
    player: { findFirst: vi.fn() },
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
  cacheInvalidatePattern: vi.fn(),
}))

import { prisma } from '../../../shared/lib/prisma.js'
import { createSnapshot, writeAudit } from '../../saves/snapshots.service.js'
import { createTransfer, updateTransfer, reverseTransfer } from '../transfers.service.js'

const mockedPrisma = prisma as unknown as {
  transfer: { findFirst: ReturnType<typeof vi.fn> }
  player: { findFirst: ReturnType<typeof vi.fn> }
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

// Save carregado por createTransfer (include clubStints isCurrent). Campos exigidos por
// formatSaveResponse: id, balance, budget, currentSeason, currentYear.
function mockSaveForCreate(balance: number) {
  mockedPrisma.save.findUnique.mockResolvedValue({
    id: SAVE_ID,
    balance,
    budget: 200,
    currentSeason: '2025/26',
    currentYear: 2025,
    clubStints: [{ id: STINT_ID }],
  })
}

describe('createTransfer (balance math + squad)', () => {
  it('compra: subtrai a fee do saldo, cria o jogador e o adiciona ao elenco ativo', async () => {
    mockSaveForCreate(100)
    txMock.player.findFirst.mockResolvedValue(null) // sem homônimo inativo → cria novo
    txMock.player.create.mockResolvedValue({ id: 'p-new' })
    txMock.transfer.create.mockResolvedValue({ id: 'tr-new', fee: 30 })
    txMock.save.update.mockResolvedValue({ id: SAVE_ID, balance: 70, budget: 200, currentSeason: '2025/26', currentYear: 2025 })

    const result = await createTransfer(SAVE_ID, {
      playerName: 'Novato', type: TransferType.compra, from: 'A', to: 'B', fee: 30, season: '2025/26',
    })

    expect(txMock.player.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ saveId: SAVE_ID, name: 'Novato', activeClubStintId: STINT_ID, status: PlayerStatus.Role }),
    }))
    expect(txMock.playerSeasonStats.createMany).toHaveBeenCalled()
    // saldo: 100 - 30
    expect(txMock.save.update).toHaveBeenCalledWith({ where: { id: SAVE_ID }, data: { balance: 70 } })
    expect(result.playerId).toBe('p-new')
    expect(result.save?.balance).toBe(70)
  })

  it('venda: soma a fee ao saldo e remove o jogador do elenco', async () => {
    mockSaveForCreate(100)
    mockedPrisma.player.findFirst.mockResolvedValue({ id: PLAYER_ID, name: 'Craque', activeClubStintId: STINT_ID })
    txMock.transfer.create.mockResolvedValue({ id: 'tr-new', fee: 40 })
    txMock.save.update.mockResolvedValue({ id: SAVE_ID, balance: 140, budget: 200, currentSeason: '2025/26', currentYear: 2025 })

    const result = await createTransfer(SAVE_ID, {
      playerName: 'Craque', type: TransferType.venda, from: 'B', to: 'A', fee: 40, season: '2025/26', playerId: PLAYER_ID,
    })

    expect(txMock.player.update).toHaveBeenCalledWith({ where: { id: PLAYER_ID }, data: { activeClubStintId: null } })
    // saldo: 100 + 40
    expect(txMock.save.update).toHaveBeenCalledWith({ where: { id: SAVE_ID }, data: { balance: 140 } })
    expect(result.save?.balance).toBe(140)
  })

  it('emprestimo_entrada: nunca mexe no saldo (mesmo com fee) e marca o jogador como Loan', async () => {
    mockSaveForCreate(100)
    txMock.player.findFirst.mockResolvedValue(null)
    txMock.player.create.mockResolvedValue({ id: 'p-loan' })
    txMock.transfer.create.mockResolvedValue({ id: 'tr-new', fee: 5 })

    const result = await createTransfer(SAVE_ID, {
      playerName: 'Emprestado', type: TransferType.emprestimo_entrada, from: 'X', to: 'B', fee: 5, season: '2025/26',
    })

    expect(txMock.player.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: PlayerStatus.Loan }),
    }))
    expect(txMock.save.update).not.toHaveBeenCalled()
    expect(result.save?.balance).toBe(100) // saldo original, intocado
  })

  it('emprestimo_saida: não mexe no saldo, remove do elenco, marca Loan, define returnSeason e abre LoanSpellStats', async () => {
    mockSaveForCreate(100)
    mockedPrisma.player.findFirst.mockResolvedValue({ id: PLAYER_ID, name: 'Cedido', activeClubStintId: STINT_ID })
    txMock.transfer.create.mockResolvedValue({ id: 'tr-new', fee: null })

    await createTransfer(SAVE_ID, {
      playerName: 'Cedido', type: TransferType.emprestimo_saida, from: 'B', to: 'Y', season: '2025/26', playerId: PLAYER_ID,
    })

    expect(txMock.player.update).toHaveBeenCalledWith({
      where: { id: PLAYER_ID },
      data: { activeClubStintId: null, status: PlayerStatus.Loan },
    })
    expect(txMock.save.update).not.toHaveBeenCalled()
    // B-002: default 1 temporada → returnSeason = próxima temporada
    expect(txMock.transfer.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: TransferType.emprestimo_saida, returnSeason: '2026/27' }),
    }))
    // B-001: abre a linha informativa de loan-spell stats da temporada
    expect(txMock.loanSpellStats.create).toHaveBeenCalledWith({
      data: { saveId: SAVE_ID, playerId: PLAYER_ID, transferId: 'tr-new', loanClub: 'Y', season: '2025/26' },
    })
  })

  it('emprestimo_saida com loanSeasons=2 define returnSeason 2 temporadas à frente (B-002)', async () => {
    mockSaveForCreate(100)
    mockedPrisma.player.findFirst.mockResolvedValue({ id: PLAYER_ID, name: 'Cedido', activeClubStintId: STINT_ID })
    txMock.transfer.create.mockResolvedValue({ id: 'tr-new', fee: null })

    await createTransfer(SAVE_ID, {
      playerName: 'Cedido', type: TransferType.emprestimo_saida, from: 'B', to: 'Y', season: '2025/26', playerId: PLAYER_ID, loanSeasons: 2,
    })

    expect(txMock.transfer.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ returnSeason: '2027/28' }),
    }))
  })

  it('rejeita loanSeasons inválido (3) com 400 e não abre transação', async () => {
    await expect(createTransfer(SAVE_ID, {
      playerName: 'Cedido', type: TransferType.emprestimo_saida, from: 'B', to: 'Y', season: '2025/26', playerId: PLAYER_ID, loanSeasons: 3,
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('compra com fee 0 não atualiza o saldo', async () => {
    mockSaveForCreate(100)
    txMock.player.findFirst.mockResolvedValue(null)
    txMock.player.create.mockResolvedValue({ id: 'p-free' })
    txMock.transfer.create.mockResolvedValue({ id: 'tr-new', fee: 0 })

    const result = await createTransfer(SAVE_ID, {
      playerName: 'Livre', type: TransferType.compra, from: 'A', to: 'B', fee: 0, season: '2025/26',
    })

    expect(txMock.save.update).not.toHaveBeenCalled()
    expect(result.save?.balance).toBe(100)
  })

  it('rejeita quando from/to estão ausentes (400)', async () => {
    await expect(createTransfer(SAVE_ID, {
      playerName: 'X', type: TransferType.compra, from: '', to: 'B', fee: 1, season: '2025/26',
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejeita formato de temporada inválido (400)', async () => {
    await expect(createTransfer(SAVE_ID, {
      playerName: 'X', type: TransferType.compra, from: 'A', to: 'B', fee: 1, season: '2025',
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('404 quando o save não existe', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue(null)
    await expect(createTransfer(SAVE_ID, {
      playerName: 'X', type: TransferType.compra, from: 'A', to: 'B', fee: 1, season: '2025/26',
    })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('venda: 404 quando o playerId não pertence ao save', async () => {
    mockSaveForCreate(100)
    mockedPrisma.player.findFirst.mockResolvedValue(null)
    await expect(createTransfer(SAVE_ID, {
      playerName: 'X', type: TransferType.venda, from: 'B', to: 'A', fee: 10, season: '2025/26', playerId: 'ghost',
    })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('venda: 400 quando o jogador não está no elenco ativo', async () => {
    mockSaveForCreate(100)
    mockedPrisma.player.findFirst.mockResolvedValue({ id: PLAYER_ID, name: 'Banco', activeClubStintId: null })
    await expect(createTransfer(SAVE_ID, {
      playerName: 'Banco', type: TransferType.venda, from: 'B', to: 'A', fee: 10, season: '2025/26', playerId: PLAYER_ID,
    })).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('updateTransfer (balance reversal math)', () => {
  it('muda a fee de uma compra: estorna a antiga e aplica a nova no saldo', async () => {
    mockedPrisma.transfer.findFirst.mockResolvedValue({ id: TID, saveId: SAVE_ID, type: TransferType.compra, fee: 20 })
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, balance: 100 })
    txMock.transfer.update.mockResolvedValue({ id: TID })

    await updateTransfer(SAVE_ID, TID, { fee: 50 })

    // estorna compra antiga (+20 → 120) e aplica nova compra (-50 → 70)
    expect(txMock.save.update).toHaveBeenCalledWith({ where: { id: SAVE_ID }, data: { balance: 70 } })
    expect(txMock.transfer.update).toHaveBeenCalledWith({ where: { id: TID }, data: { fee: 50 } })
  })

  it('troca o tipo de compra para venda: estorna a compra e credita a venda', async () => {
    mockedPrisma.transfer.findFirst.mockResolvedValue({ id: TID, saveId: SAVE_ID, type: TransferType.compra, fee: 30 })
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, balance: 100 })
    txMock.transfer.update.mockResolvedValue({ id: TID })

    await updateTransfer(SAVE_ID, TID, { type: TransferType.venda })

    // estorna compra antiga (+30 → 130) e aplica venda nova (+30 → 160)
    expect(txMock.save.update).toHaveBeenCalledWith({ where: { id: SAVE_ID }, data: { balance: 160 } })
  })

  it('sem mudança de fee nem tipo: não toca o saldo, só atualiza a linha', async () => {
    mockedPrisma.transfer.findFirst.mockResolvedValue({ id: TID, saveId: SAVE_ID, type: TransferType.compra, fee: 30 })
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, balance: 100 })
    txMock.transfer.update.mockResolvedValue({ id: TID })

    await updateTransfer(SAVE_ID, TID, { playerName: 'Novo Nome' })

    expect(txMock.save.update).not.toHaveBeenCalled()
    expect(txMock.transfer.update).toHaveBeenCalledWith({ where: { id: TID }, data: { playerName: 'Novo Nome' } })
  })

  it('404 quando a transferência não existe no save', async () => {
    mockedPrisma.transfer.findFirst.mockResolvedValue(null)
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, balance: 100 })
    await expect(updateTransfer(SAVE_ID, TID, { fee: 1 })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejeita formato de temporada inválido (400)', async () => {
    mockedPrisma.transfer.findFirst.mockResolvedValue({ id: TID, saveId: SAVE_ID, type: TransferType.compra, fee: 10 })
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, balance: 100 })
    await expect(updateTransfer(SAVE_ID, TID, { season: 'nope' })).rejects.toMatchObject({ statusCode: 400 })
  })
})
