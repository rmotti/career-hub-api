import { prisma } from '../../shared/lib/prisma.js'
import { AppError, NotFoundError } from '../../shared/utils/errors.js'
import { formatBalance, formatMarketValue } from '../../shared/utils/currency.js'
import { TransferType, Position, PlayerStatus } from '@prisma/client'

const SEASON_PATTERN = /^\d{4}\/\d{2}$/

const COMPRA_TYPES: TransferType[] = [TransferType.compra, TransferType.emprestimo_entrada]
const VENDA_TYPES: TransferType[]  = [TransferType.venda,  TransferType.emprestimo_saida]

function formatSaveResponse(save: { id: string; balance: number | null; budget: number | null; currentSeason: string; currentYear: number }) {
  return {
    id: save.id,
    currentSeason: save.currentSeason,
    currentYear: save.currentYear,
    balance: save.balance,
    balanceFormatted: formatBalance(save.balance),
    budget: save.budget,
    budgetFormatted: formatBalance(save.budget),
  }
}

function formatTransferResponse<T extends { fee: number | null }>(transfer: T) {
  return { ...transfer, feeFormatted: formatMarketValue(transfer.fee) }
}

export async function listTransfers(saveId: string, seasonFilter?: string) {
  const save = await prisma.save.findUnique({ where: { id: saveId } })
  if (!save) throw new NotFoundError('Save não encontrado.')

  const where: { saveId: string; season?: string } = { saveId }
  if (seasonFilter === 'current') where.season = save.currentSeason

  const transfers = await prisma.transfer.findMany({
    where,
    include: { player: true },
    orderBy: { createdAt: 'desc' },
  })

  return transfers.map(formatTransferResponse)
}

export async function createTransfer(
  saveId: string,
  data: {
    playerName: string
    type: TransferType
    from: string
    to: string
    fee?: number
    season: string
    playerId?: string
  }
) {
  if (!data.from || !data.to) {
    throw new AppError("Os campos 'from' e 'to' são obrigatórios.", 400)
  }

  if (!SEASON_PATTERN.test(data.season)) {
    throw new AppError('Formato de temporada inválido. Use o formato YYYY/YY (ex: 2028/29).', 400)
  }

  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: { where: { isCurrent: true } } },
  })
  if (!save) throw new NotFoundError('Save não encontrado.')

  const currentStint = save.clubStints[0]

  // Validate venda/emprestimo_saida: playerId must belong to active squad
  if (VENDA_TYPES.includes(data.type) && data.playerId) {
    const player = await prisma.player.findFirst({ where: { id: data.playerId, saveId } })
    if (!player) throw new AppError('Jogador não encontrado neste save. Verifique o ID informado.', 404)
    if (!player.activeClubStintId) {
      throw new AppError(`Não é possível registrar saída: o jogador '${player.name}' não está no elenco ativo.`, 400)
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    let resolvedPlayerId: string | null = data.playerId ?? null

    // ── ENTRADA (compra / emprestimo_entrada): resolve or create player ──
    if (COMPRA_TYPES.includes(data.type)) {
      const existingPlayer = data.playerId
        ? await tx.player.findFirst({ where: { id: data.playerId, saveId } })
        : null

      const newStatus = data.type === TransferType.emprestimo_entrada ? PlayerStatus.Loan : PlayerStatus.Role

      if (existingPlayer) {
        resolvedPlayerId = existingPlayer.id
        await tx.player.update({
          where: { id: existingPlayer.id },
          data: { activeClubStintId: currentStint?.id ?? null, status: newStatus },
        })
      } else {
        const inactiveMatch = await tx.player.findFirst({
          where: { saveId, name: data.playerName, activeClubStintId: null },
        })

        const targetPlayer = inactiveMatch ?? await tx.player.create({
          data: {
            saveId,
            name: data.playerName,
            position: Position.MEI,
            age: 25,
            status: newStatus,
            ovr: 70,
          },
        })

        resolvedPlayerId = targetPlayer.id
        await tx.player.update({
          where: { id: targetPlayer.id },
          data: { activeClubStintId: currentStint?.id ?? null, status: newStatus },
        })
      }

      if (currentStint && resolvedPlayerId) {
        const existing = await tx.playerSeasonStats.findFirst({
          where: { playerId: resolvedPlayerId, clubStintId: currentStint.id, season: save.currentSeason },
        })
        if (!existing) {
          await tx.playerSeasonStats.create({
            data: { playerId: resolvedPlayerId, clubStintId: currentStint.id, season: save.currentSeason },
          })
        }
      }
    }

    // Create transfer with the resolved playerId
    const newTransfer = await tx.transfer.create({
      data: {
        saveId,
        playerName: data.playerName,
        type: data.type,
        from: data.from,
        to: data.to,
        fee: data.fee,
        season: data.season,
        playerId: resolvedPlayerId,
      },
    })

    // ── SAÍDA (venda / emprestimo_saida): remove player from active squad ──
    if (VENDA_TYPES.includes(data.type) && resolvedPlayerId) {
      await tx.player.update({
        where: { id: resolvedPlayerId },
        data: {
          activeClubStintId: null,
          ...(data.type === TransferType.emprestimo_saida && { status: PlayerStatus.Loan }),
        },
      })
    }

    // Update balance only for compra/venda (not for empréstimos)
    const fee = data.fee ?? 0
    let currentSave = await tx.save.findUnique({ where: { id: saveId } })
    const balanceAffects = data.type === TransferType.compra || data.type === TransferType.venda

    let updatedSave = currentSave
    if (fee > 0 && balanceAffects) {
      const currentBalance = currentSave?.balance ?? 0
      const newBalance =
        data.type === TransferType.compra
          ? currentBalance - fee
          : currentBalance + fee
      updatedSave = await tx.save.update({
        where: { id: saveId },
        data: { balance: newBalance },
      })
    }

    return { transfer: newTransfer, playerId: resolvedPlayerId, save: updatedSave }
  })

  return {
    transfer: formatTransferResponse(result.transfer),
    playerId: result.playerId,
    save: result.save ? formatSaveResponse(result.save) : null,
  }
}

export async function updateTransfer(
  saveId: string,
  tid: string,
  data: {
    playerName?: string
    type?: TransferType
    from?: string
    to?: string
    fee?: number
    season?: string
  }
) {
  const transfer = await prisma.transfer.findFirst({ where: { id: tid, saveId } })
  if (!transfer) throw new NotFoundError('Transferência não encontrada.')

  if (data.season && !SEASON_PATTERN.test(data.season)) {
    throw new AppError('Formato de temporada inválido. Use o formato YYYY/YY (ex: 2028/29).', 400)
  }

  return prisma.$transaction(async (tx) => {
    const feeChanged = data.fee !== undefined && data.fee !== transfer.fee
    const typeChanged = data.type !== undefined && data.type !== transfer.type

    if (feeChanged || typeChanged) {
      const currentSave = await tx.save.findUnique({ where: { id: saveId } })
      let newBalance = currentSave?.balance ?? 0

      // Reverse old fee effect (only for compra/venda)
      const oldFee = transfer.fee ?? 0
      if (oldFee > 0) {
        if (transfer.type === TransferType.compra) newBalance += oldFee
        else if (transfer.type === TransferType.venda) newBalance -= oldFee
      }

      // Apply new fee effect (only for compra/venda)
      const newFee = data.fee ?? transfer.fee ?? 0
      const newType = data.type ?? transfer.type
      if (newFee > 0) {
        if (newType === TransferType.compra) newBalance -= newFee
        else if (newType === TransferType.venda) newBalance += newFee
      }

      await tx.save.update({ where: { id: saveId }, data: { balance: newBalance } })
    }

    return tx.transfer.update({ where: { id: tid }, data })
  })
}

export async function deleteTransfer(saveId: string, tid: string) {
  const transfer = await prisma.transfer.findFirst({ where: { id: tid, saveId } })
  if (!transfer) throw new NotFoundError('Transferência não encontrada.')

  await prisma.transfer.delete({ where: { id: tid } })
}
