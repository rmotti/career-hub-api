import { prisma } from '../lib/prisma'
import { AppError, NotFoundError } from '../utils/errors'
import { parseCurrency, formatCurrency, isValidCurrencyFormat } from '../utils/currency'
import { TransferType, Position, PlayerStatus } from '@prisma/client'

const SEASON_PATTERN = /^\d{4}\/\d{2}$/

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
    fee?: string
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

  if (data.fee && data.fee !== '€0' && !isValidCurrencyFormat(data.fee)) {
    throw new AppError('Formato de valor de transferência inválido. Use o formato €XK ou €XM (ex: €45M).', 400)
  }

  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: { where: { isCurrent: true } } },
  })
  if (!save) throw new NotFoundError('Save não encontrado.')

  const currentStint = save.clubStints[0]

  if (data.playerId) {
    const player = await prisma.player.findFirst({ where: { id: data.playerId, saveId } })
    if (!player) throw new AppError('Jogador não encontrado neste save. Verifique o ID informado.', 404)

    if (data.type === TransferType.venda && !player.activeClubStintId) {
      throw new AppError(`Não é possível registrar venda: o jogador '${player.name}' não está no elenco ativo.`, 400)
    }

    if (data.type === TransferType.compra && player.activeClubStintId) {
      throw new AppError(`O jogador '${player.name}' já está no elenco ativo desta temporada.`, 400)
    }
  }

  const transfer = await prisma.$transaction(async (tx) => {
    const newTransfer = await tx.transfer.create({
      data: { saveId, ...data },
    })

    if (data.type === TransferType.compra) {
      if (data.playerId) {
        // Reactivate existing player
        await tx.player.update({
          where: { id: data.playerId },
          data: { activeClubStintId: currentStint?.id ?? null },
        })

        if (currentStint) {
          const existing = await tx.playerSeasonStats.findFirst({
            where: {
              playerId: data.playerId,
              clubStintId: currentStint.id,
              season: save.currentSeason,
            },
          })

          if (!existing) {
            await tx.playerSeasonStats.create({
              data: {
                playerId: data.playerId,
                clubStintId: currentStint.id,
                season: save.currentSeason,
              },
            })
          }
        }
      } else {
        // Try to find an existing inactive player with the same name before creating a new one
        const existingInactivePlayer = await tx.player.findFirst({
          where: { saveId, name: data.playerName, activeClubStintId: null },
        })

        const targetPlayerId = existingInactivePlayer
          ? existingInactivePlayer.id
          : (
              await tx.player.create({
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
            ).id

        await tx.player.update({
          where: { id: targetPlayerId },
          data: { activeClubStintId: currentStint?.id ?? null },
        })

        if (currentStint) {
          const existing = await tx.playerSeasonStats.findFirst({
            where: { playerId: targetPlayerId, clubStintId: currentStint.id, season: save.currentSeason },
          })

          if (!existing) {
            await tx.playerSeasonStats.create({
              data: {
                playerId: targetPlayerId,
                clubStintId: currentStint.id,
                season: save.currentSeason,
              },
            })
          }
        }
      }
    } else if (data.type === TransferType.venda && data.playerId) {
      await tx.player.update({
        where: { id: data.playerId },
        data: { activeClubStintId: null },
      })
    }

    if (data.fee && data.fee !== '€0') {
      const currentSave = await tx.save.findUnique({ where: { id: saveId } })
      if (currentSave?.balance) {
        const currentBalance = parseCurrency(currentSave.balance)
        const fee = parseCurrency(data.fee)
        const newBalance =
          data.type === TransferType.compra ? currentBalance - fee : currentBalance + fee
        await tx.save.update({
          where: { id: saveId },
          data: { balance: formatCurrency(newBalance) },
        })
      }
    }

    return newTransfer
  })

  return transfer
}

export async function updateTransfer(
  saveId: string,
  tid: string,
  data: {
    playerName?: string
    type?: TransferType
    from?: string
    to?: string
    fee?: string
    season?: string
  }
) {
  const transfer = await prisma.transfer.findFirst({ where: { id: tid, saveId } })
  if (!transfer) throw new NotFoundError('Transferência não encontrada.')

  if (data.season && !SEASON_PATTERN.test(data.season)) {
    throw new AppError('Formato de temporada inválido. Use o formato YYYY/YY (ex: 2028/29).', 400)
  }

  if (data.fee && data.fee !== '€0' && !isValidCurrencyFormat(data.fee)) {
    throw new AppError('Formato de valor de transferência inválido. Use o formato €XK ou €XM (ex: €45M).', 400)
  }

  return prisma.transfer.update({ where: { id: tid }, data })
}

export async function deleteTransfer(saveId: string, tid: string) {
  const transfer = await prisma.transfer.findFirst({ where: { id: tid, saveId } })
  if (!transfer) throw new NotFoundError('Transferência não encontrada.')

  await prisma.transfer.delete({ where: { id: tid } })
}
