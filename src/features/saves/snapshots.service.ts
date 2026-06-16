import { Prisma } from '@prisma/client'
import { prisma } from '../../shared/lib/prisma.js'
import { NotFoundError } from '../../shared/utils/errors.js'
import { cacheInvalidate, cacheInvalidatePattern } from '../../shared/utils/cache.js'

type Tx = Prisma.TransactionClient

// Motivos canônicos de um snapshot. 'manual' é o save-point sob demanda do usuário.
export type SnapshotReason =
  | 'pre-season-advance'
  | 'pre-delete'
  | 'pre-transfer-reverse'
  | 'pre-player-release'
  | 'pre-club-change'
  | 'pre-fc26-import'
  | 'manual'

// Ações auditáveis (mutações irreversíveis ou de recuperação).
export type AuditAction =
  | 'save.season_advance'
  | 'save.soft_delete'
  | 'save.purge'
  | 'save.restore'
  | 'save.snapshot_restore'
  | 'save.snapshot_create'
  | 'save.finance_edit'
  | 'transfer.reverse'
  | 'player.release'
  | 'clubstint.change'
  | 'squad.import'

// Quantos snapshots automáticos manter por save (poda os mais antigos na criação).
const MAX_SNAPSHOTS_PER_SAVE = 10

const SNAPSHOT_PAYLOAD_VERSION = 1

/**
 * Lê todas as linhas filhas de um save como arrays planos (sem includes), prontas para
 * serem regravadas via `createMany` preservando os IDs. A ordem das chaves não importa
 * aqui — o restore reinsere na ordem correta de FK.
 */
async function collectSavePayload(tx: Tx, saveId: string) {
  const save = await tx.save.findUnique({ where: { id: saveId } })
  if (!save) throw new NotFoundError('Save não encontrado.')

  const clubStints = await tx.clubStint.findMany({ where: { saveId } })
  const stintIds = clubStints.map((s) => s.id)
  const players = await tx.player.findMany({ where: { saveId } })
  const playerIds = players.map((p) => p.id)

  const [
    transfers,
    scoutPlaybooks,
    shortlistItems,
    savedSearches,
    teamSeasonStats,
    playerSeasonStats,
    trophies,
    playerOvrHistory,
  ] = await Promise.all([
    tx.transfer.findMany({ where: { saveId } }),
    tx.scoutPlaybook.findMany({ where: { saveId } }),
    tx.shortlistItem.findMany({ where: { saveId } }),
    tx.savedSearch.findMany({ where: { saveId } }),
    stintIds.length ? tx.teamSeasonStats.findMany({ where: { clubStintId: { in: stintIds } } }) : [],
    stintIds.length ? tx.playerSeasonStats.findMany({ where: { clubStintId: { in: stintIds } } }) : [],
    stintIds.length ? tx.trophy.findMany({ where: { clubStintId: { in: stintIds } } }) : [],
    playerIds.length ? tx.playerOvrHistory.findMany({ where: { playerId: { in: playerIds } } }) : [],
  ])

  return {
    version: SNAPSHOT_PAYLOAD_VERSION,
    save: {
      name: save.name,
      currentYear: save.currentYear,
      currentSeason: save.currentSeason,
      budget: save.budget,
      balance: save.balance,
    },
    clubStints,
    players,
    transfers,
    scoutPlaybooks,
    shortlistItems,
    savedSearches,
    teamSeasonStats,
    playerSeasonStats,
    trophies,
    playerOvrHistory,
  }
}

type SavePayload = Awaited<ReturnType<typeof collectSavePayload>>

/**
 * Cria um snapshot do save dentro de uma transação. Usado tanto pelos gatilhos automáticos
 * (avanço de temporada, delete) quanto pelo save-point manual. Poda os snapshots excedentes.
 */
export async function createSnapshot(
  tx: Tx,
  saveId: string,
  userId: string,
  reason: SnapshotReason
) {
  const payload = await collectSavePayload(tx, saveId)
  const snapshot = await tx.saveSnapshot.create({
    data: { saveId, userId, reason, payload: payload as unknown as Prisma.InputJsonValue },
  })

  // Mantém só os MAX mais recentes — apaga o excedente mais antigo.
  const stale = await tx.saveSnapshot.findMany({
    where: { saveId },
    orderBy: { createdAt: 'desc' },
    skip: MAX_SNAPSHOTS_PER_SAVE,
    select: { id: true },
  })
  if (stale.length > 0) {
    await tx.saveSnapshot.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } })
  }

  return snapshot
}

/** Grava uma linha de auditoria. Aceita tx ou o client direto; falha silenciosa não desejada aqui. */
export async function writeAudit(
  client: Tx | typeof prisma,
  entry: { userId: string; saveId?: string | null; action: AuditAction; meta?: Prisma.InputJsonValue }
) {
  await client.auditLog.create({
    data: {
      userId: entry.userId,
      saveId: entry.saveId ?? null,
      action: entry.action,
      meta: entry.meta,
    },
  })
}

async function assertOwnedSave(saveId: string, userId: string) {
  const save = await prisma.save.findUnique({ where: { id: saveId }, select: { userId: true } })
  if (!save || save.userId !== userId) throw new NotFoundError('Save não encontrado.')
}

export async function listSnapshots(saveId: string, userId: string) {
  await assertOwnedSave(saveId, userId)
  return prisma.saveSnapshot.findMany({
    where: { saveId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, reason: true, createdAt: true },
  })
}

/** Histórico de auditoria de um save (mutações irreversíveis e recuperações), mais recente primeiro. */
export async function listAuditLog(saveId: string, userId: string) {
  await assertOwnedSave(saveId, userId)
  return prisma.auditLog.findMany({
    where: { saveId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, action: true, meta: true, createdAt: true },
  })
}

export async function createManualSnapshot(saveId: string, userId: string) {
  await assertOwnedSave(saveId, userId)
  const snapshot = await prisma.$transaction(async (tx) => {
    const snap = await createSnapshot(tx, saveId, userId, 'manual')
    await writeAudit(tx, { userId, saveId, action: 'save.snapshot_create', meta: { snapshotId: snap.id } })
    return snap
  })
  return { id: snapshot.id, reason: snapshot.reason, createdAt: snapshot.createdAt }
}

/**
 * Restaura o save ao estado de um snapshot: apaga as linhas filhas atuais, reinsere as do
 * payload (preservando IDs), redefine os escalares do save e limpa `deletedAt` (des-arquiva).
 * Tudo numa transação. Competições/Fc26Player são tabelas externas e não são tocadas.
 */
export async function restoreSnapshot(saveId: string, snapshotId: string, userId: string) {
  await assertOwnedSave(saveId, userId)

  const snapshot = await prisma.saveSnapshot.findUnique({ where: { id: snapshotId } })
  if (!snapshot || snapshot.saveId !== saveId) throw new NotFoundError('Snapshot não encontrado.')

  const payload = snapshot.payload as unknown as SavePayload

  await prisma.$transaction(async (tx) => {
    // 1) Apaga filhos na ordem reversa de FK.
    await tx.playerOvrHistory.deleteMany({ where: { player: { saveId } } })
    await tx.playerSeasonStats.deleteMany({ where: { clubStint: { saveId } } })
    await tx.trophy.deleteMany({ where: { clubStint: { saveId } } })
    await tx.teamSeasonStats.deleteMany({ where: { clubStint: { saveId } } })
    await tx.transfer.deleteMany({ where: { saveId } })
    await tx.player.deleteMany({ where: { saveId } })
    await tx.shortlistItem.deleteMany({ where: { saveId } })
    await tx.savedSearch.deleteMany({ where: { saveId } })
    await tx.scoutPlaybook.deleteMany({ where: { saveId } })
    await tx.clubStint.deleteMany({ where: { saveId } })

    // 2) Reinsere na ordem de FK (pais antes de filhos).
    const insert = async <T>(rows: T[], fn: (data: T[]) => Promise<unknown>) => {
      if (rows.length > 0) await fn(rows)
    }
    await insert(payload.clubStints, (data) => tx.clubStint.createMany({ data: data as Prisma.ClubStintCreateManyInput[] }))
    await insert(payload.players, (data) => tx.player.createMany({ data: data as Prisma.PlayerCreateManyInput[] }))
    await insert(payload.transfers, (data) => tx.transfer.createMany({ data: data as Prisma.TransferCreateManyInput[] }))
    await insert(payload.teamSeasonStats, (data) => tx.teamSeasonStats.createMany({ data: data as Prisma.TeamSeasonStatsCreateManyInput[] }))
    await insert(payload.playerSeasonStats, (data) => tx.playerSeasonStats.createMany({ data: data as Prisma.PlayerSeasonStatsCreateManyInput[] }))
    await insert(payload.trophies, (data) => tx.trophy.createMany({ data: data as Prisma.TrophyCreateManyInput[] }))
    await insert(payload.playerOvrHistory, (data) => tx.playerOvrHistory.createMany({ data: data as Prisma.PlayerOvrHistoryCreateManyInput[] }))
    await insert(payload.scoutPlaybooks, (data) => tx.scoutPlaybook.createMany({ data: data as Prisma.ScoutPlaybookCreateManyInput[] }))
    await insert(payload.shortlistItems, (data) => tx.shortlistItem.createMany({ data: data as Prisma.ShortlistItemCreateManyInput[] }))
    await insert(payload.savedSearches, (data) => tx.savedSearch.createMany({ data: data as Prisma.SavedSearchCreateManyInput[] }))

    // 3) Restaura escalares do save e des-arquiva.
    await tx.save.update({
      where: { id: saveId },
      data: {
        name: payload.save.name,
        currentYear: payload.save.currentYear,
        currentSeason: payload.save.currentSeason,
        budget: payload.save.budget,
        balance: payload.save.balance,
        deletedAt: null,
      },
    })

    await writeAudit(tx, {
      userId,
      saveId,
      action: 'save.snapshot_restore',
      meta: { snapshotId, reason: snapshot.reason },
    })
  })

  await cacheInvalidatePattern(`save:${saveId}:*`)
  await cacheInvalidate(`save:${saveId}`, `user:${userId}:saves`)
}
