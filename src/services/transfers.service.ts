import { prisma } from '../lib/prisma'
import { AppError, NotFoundError } from '../utils/errors'
import { formatBalance } from '../utils/currency'
import { TransferType, Position, PlayerStatus } from '@prisma/client'

const SEASON_PATTERN = /^\d{4}\/\d{2}$/

function formatSaveResponse(save: { id: string; balance: number | null; budget: number | null }) {
  return {
    id: save.id,
    balance: save.balance,
    balanceFormatted: formatBalance(save.balance),
    budget: save.budget,
    budgetFormatted: formatBalance(save.budget),
  }
}

export async function listTransfers(saveId: string, seasonFilter?: string) {
  const save = await prisma.save.findUnique({ where: { id: saveId } })
  if (!save) throw new NotFoundError('Save não encontrado.')

  const where: { saveId: string; season?: string } = { saveId }
  if (seasonFilter === 'current') {
    where.season = save.currentSeason
  }

  return prisma.transfer.findMany({
    where,
    include: { player: true },
    orderBy: { createdAt: 'desc' },
  })
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

  // For venda: validate playerId belongs to active squad
  if (data.type === TransferType.venda && data.playerId) {
    const player = await prisma.player.findFirst({ where: { id: data.playerId, saveId } })
    if (!player) throw new AppError('Jogador não encontrado neste save. Verifique o ID informado.', 404)
    if (!player.activeClubStintId) {
      throw new AppError(`Não é possível registrar venda: o jogador '${player.name}' não está no elenco ativo.`, 400)
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const newTransfer = await tx.transfer.create({
      data: { saveId, ...data },
    })

    let resolvedPlayerId: string | null = null

    if (data.type === TransferType.compra) {
      // If playerId provided and player exists in save → reactivate
      const existingPlayer = data.playerId
        ? await tx.player.findFirst({ where: { id: data.playerId, saveId } })
        : null

      if (existingPlayer) {
        resolvedPlayerId = existingPlayer.id
        await tx.player.update({
          where: { id: existingPlayer.id },
          data: { activeClubStintId: currentStint?.id ?? null },
        })
      } else {
        // No playerId or player not found → find inactive by name or create new
        const inactiveMatch = await tx.player.findFirst({
          where: { saveId, name: data.playerName, activeClubStintId: null },
        })

        const targetPlayer = inactiveMatch ?? await tx.player.create({
          data: {
            saveId,
            name: data.playerName,
            position: Position.MEI,
            age: 25,
            status: PlayerStatus.Role,
            ovr: 70,
            activeClubStintId: null,
          },
        })

        resolvedPlayerId = targetPlayer.id
        await tx.player.update({
          where: { id: targetPlayer.id },
          data: { activeClubStintId: currentStint?.id ?? null },
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
    } else if (data.type === TransferType.venda && data.playerId) {
      resolvedPlayerId = data.playerId
      await tx.player.update({
        where: { id: data.playerId },
        data: { activeClubStintId: null },
      })
    }

    // Update balance for compra/venda with a fee
    const fee = data.fee ?? 0
    let updatedSave = await tx.save.findUnique({ where: { id: saveId } })
    if (fee > 0 && updatedSave?.balance != null && (data.type === TransferType.compra || data.type === TransferType.venda)) {
      const newBalance =
        data.type === TransferType.compra
          ? updatedSave.balance - fee
          : updatedSave.balance + fee
      updatedSave = await tx.save.update({
        where: { id: saveId },
        data: { balance: newBalance },
      })
    }

    return { transfer: newTransfer, playerId: resolvedPlayerId, save: updatedSave }
  })

  return {
    transfer: result.transfer,
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
      if (currentSave?.balance != null) {
        let newBalance = currentSave.balance

        // Reverse old fee effect
        const oldFee = transfer.fee ?? 0
        if (oldFee > 0) {
          if (transfer.type === TransferType.compra) newBalance += oldFee
          else if (transfer.type === TransferType.venda) newBalance -= oldFee
        }

        // Apply new fee effect
        const newFee = data.fee ?? transfer.fee ?? 0
        const newType = data.type ?? transfer.type
        if (newFee > 0) {
          if (newType === TransferType.compra) newBalance -= newFee
          else if (newType === TransferType.venda) newBalance += newFee
        }

        await tx.save.update({ where: { id: saveId }, data: { balance: newBalance } })
      }
    }

    return tx.transfer.update({ where: { id: tid }, data })
  })
}

export async function deleteTransfer(saveId: string, tid: string) {
  const transfer = await prisma.transfer.findFirst({ where: { id: tid, saveId } })
  if (!transfer) throw new NotFoundError('Transferência não encontrada.')

  await prisma.transfer.delete({ where: { id: tid } })
}