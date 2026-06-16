import { prisma } from '../../shared/lib/prisma.js'
import { AppError, NotFoundError } from '../../shared/utils/errors.js'
import { formatBalance, formatMarketValue } from '../../shared/utils/currency.js'
import { TransferType, Position, PlayerStatus } from '@prisma/client'
import { cacheGet, cacheSet, cacheInvalidate } from '../../shared/utils/cache.js'
import { createSnapshot, writeAudit } from '../saves/snapshots.service.js'
import { invalidatePlayersCache } from '../players/players.service.js'

const TTL_TRANSFERS = 60 * 30 // 30 min

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
  const cacheKey = seasonFilter === 'current'
    ? `save:${saveId}:transfers:current`
    : `save:${saveId}:transfers`

  const cached = await cacheGet<unknown[]>(cacheKey)
  if (cached) return cached

  const save = await prisma.save.findUnique({
    where: { id: saveId },
    select: { id: true, currentSeason: true, clubStints: { where: { isCurrent: true }, select: { id: true } } },
  })
  if (!save) throw new NotFoundError('Save não encontrado.')

  const where: { saveId: string; season?: string; clubStintId?: string } = { saveId }
  if (seasonFilter === 'current') {
    where.season = save.currentSeason
    const currentStint = save.clubStints[0]
    if (currentStint) where.clubStintId = currentStint.id
  }

  const transfers = await prisma.transfer.findMany({
    where,
    select: {
      id: true,
      saveId: true,
      playerName: true,
      type: true,
      from: true,
      to: true,
      fee: true,
      season: true,
      createdAt: true,
      playerId: true,
      player: {
        select: { id: true, name: true, position: true, alternativePosition: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const result = transfers.map(formatTransferResponse)
  await cacheSet(cacheKey, result, TTL_TRANSFERS)
  return result
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

        const targetPlayer = inactiveMatch
          ? await tx.player.update({
              where: { id: inactiveMatch.id },
              data: { activeClubStintId: currentStint?.id ?? null, status: newStatus },
            })
          : await tx.player.create({
              data: {
                saveId,
                name: data.playerName,
                position: Position.MEI,
                age: 25,
                status: newStatus,
                ovr: 70,
                activeClubStintId: currentStint?.id ?? null,
              },
            })

        resolvedPlayerId = targetPlayer.id
      }

      if (currentStint && resolvedPlayerId) {
        await tx.playerSeasonStats.createMany({
          data: [{ playerId: resolvedPlayerId, clubStintId: currentStint.id, season: save.currentSeason }],
          skipDuplicates: true,
        })
      }
    }

    // Create transfer with the resolved playerId
    const newTransfer = await tx.transfer.create({
      data: {
        saveId,
        clubStintId: currentStint?.id ?? null,
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
    // Usa o `save` já carregado fora da transação — evita query duplicada
    const fee = data.fee ?? 0
    const balanceAffects = data.type === TransferType.compra || data.type === TransferType.venda

    // Tipar apenas os campos usados por formatSaveResponse
    let updatedSave: { id: string; balance: number | null; budget: number | null; currentSeason: string; currentYear: number } = save
    if (fee > 0 && balanceAffects) {
      const currentBalance = save.balance ?? 0
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

  await cacheInvalidate(`save:${saveId}:transfers`, `save:${saveId}:transfers:current`)
  // Saídas (venda/empréstimo) tiram o jogador do elenco e mudam seu status —
  // invalida todas as chaves de players (active, loaned, seasons e o detalhe).
  await invalidatePlayersCache(saveId)

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
  const [transfer, currentSave] = await Promise.all([
    prisma.transfer.findFirst({ where: { id: tid, saveId } }),
    prisma.save.findUnique({ where: { id: saveId }, select: { id: true, balance: true } }),
  ])
  if (!transfer) throw new NotFoundError('Transferência não encontrada.')

  if (data.season && !SEASON_PATTERN.test(data.season)) {
    throw new AppError('Formato de temporada inválido. Use o formato YYYY/YY (ex: 2028/29).', 400)
  }

  const updated = await prisma.$transaction(async (tx) => {
    const feeChanged = data.fee !== undefined && data.fee !== transfer.fee
    const typeChanged = data.type !== undefined && data.type !== transfer.type

    if (feeChanged || typeChanged) {
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

  await cacheInvalidate(`save:${saveId}:transfers`, `save:${saveId}:transfers:current`)
  return formatTransferResponse(updated)
}

export async function deleteTransfer(saveId: string, tid: string) {
  const transfer = await prisma.transfer.findFirst({ where: { id: tid, saveId } })
  if (!transfer) throw new NotFoundError('Transferência não encontrada.')

  await prisma.transfer.delete({ where: { id: tid } })
  await cacheInvalidate(`save:${saveId}:transfers`, `save:${saveId}:transfers:current`)
}

/**
 * Reverte uma transferência DESFAZENDO seus efeitos colaterais (o `deleteTransfer` apenas
 * apaga a linha e deixa saldo e elenco inconsistentes). Reverte o saldo, recoloca/retira o
 * jogador do elenco conforme o tipo e remove o registro. Tira um snapshot de segurança e
 * audita a ação. Resolve o caso "vendi o jogador errado": dinheiro e jogador voltam.
 */
export async function reverseTransfer(saveId: string, tid: string, userId: string) {
  const transfer = await prisma.transfer.findFirst({ where: { id: tid, saveId } })
  if (!transfer) throw new NotFoundError('Transferência não encontrada.')

  const save = await prisma.save.findUnique({
    where: { id: saveId },
    select: { id: true, balance: true, clubStints: { where: { isCurrent: true }, select: { id: true } } },
  })
  if (!save) throw new NotFoundError('Save não encontrado.')
  const fallbackStintId = save.clubStints[0]?.id ?? null

  await prisma.$transaction(async (tx) => {
    // Rede de segurança: snapshot completo + auditoria antes de reverter.
    await createSnapshot(tx, saveId, userId, 'pre-transfer-reverse')
    await writeAudit(tx, {
      userId,
      saveId,
      action: 'transfer.reverse',
      meta: { transferId: tid, type: transfer.type, playerName: transfer.playerName, fee: transfer.fee ?? null },
    })

    // 1) Reverte o efeito no saldo (só compra/venda mexem em dinheiro).
    const fee = transfer.fee ?? 0
    if (fee > 0) {
      const balance = save.balance ?? 0
      if (transfer.type === TransferType.compra) {
        await tx.save.update({ where: { id: saveId }, data: { balance: balance + fee } })
      } else if (transfer.type === TransferType.venda) {
        await tx.save.update({ where: { id: saveId }, data: { balance: balance - fee } })
      }
    }

    // 2) Reverte o estado do jogador no elenco.
    if (transfer.playerId) {
      if (VENDA_TYPES.includes(transfer.type)) {
        // Saída revertida → jogador volta ao elenco (no stint de onde saiu).
        await tx.player.update({
          where: { id: transfer.playerId },
          data: { activeClubStintId: transfer.clubStintId ?? fallbackStintId, status: PlayerStatus.Role },
        })
      } else if (COMPRA_TYPES.includes(transfer.type)) {
        // Entrada revertida → jogador sai do elenco (vira inativo).
        await tx.player.update({
          where: { id: transfer.playerId },
          data: { activeClubStintId: null },
        })
      }
    }

    // 3) Remove o registro da transferência.
    await tx.transfer.delete({ where: { id: tid } })
  })

  await cacheInvalidate(`save:${saveId}:transfers`, `save:${saveId}:transfers:current`)
  // Reverter recoloca/retira o jogador do elenco — invalida todas as chaves de players.
  await invalidatePlayersCache(saveId)

  return { reversed: true as const }
}
