import { prisma } from '../lib/prisma'
import { NotFoundError } from '../utils/errors'
import { parseCurrency, formatCurrency } from '../utils/currency'
import { TransferType, Position, PlayerStatus } from '@prisma/client'

export async function listTransfers(saveId: string, seasonFilter?: string) {
  const save = await prisma.save.findUnique({ where: { id: saveId } })
  if (!save) throw new NotFoundError('Save not found')

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
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: { where: { isCurrent: true } } },
  })
  if (!save) throw new NotFoundError('Save not found')

  const currentStint = save.clubStints[0]

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
        // Create new player
        const newPlayer = await tx.player.create({
          data: {
            saveId,
            name: data.playerName,
            position: Position.MEI,
            age: 25,
            status: PlayerStatus.Role,
            ovr: 70,
            activeClubStintId: currentStint?.id ?? null,
          },
        })

        if (currentStint) {
          await tx.playerSeasonStats.create({
            data: {
              playerId: newPlayer.id,
              clubStintId: currentStint.id,
              season: save.currentSeason,
            },
          })
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
  if (!transfer) throw new NotFoundError('Transfer not found')

  return prisma.transfer.update({ where: { id: tid }, data })
}

export async function deleteTransfer(saveId: string, tid: string) {
  const transfer = await prisma.transfer.findFirst({ where: { id: tid, saveId } })
  if (!transfer) throw new NotFoundError('Transfer not found')

  await prisma.transfer.delete({ where: { id: tid } })
}
