import { prisma } from '../../shared/lib/prisma.js'
import { AppError, NotFoundError } from '../../shared/utils/errors.js'
import { clubExists, findLeagueByClub, LEAGUE_TO_COUNTRY } from '../clubs/clubs.service.js'
import { getCompetitionIdsByCountry } from '../competitions/competitions.service.js'
import { formatBalance } from '../../shared/utils/currency.js'
import { PlayerStatus, TransferType, type Save } from '@prisma/client'
import { cacheGet, cacheSet, cacheInvalidate, cacheInvalidatePattern } from '../../shared/utils/cache.js'
import { createSnapshot, writeAudit } from './snapshots.service.js'

const TTL = {
  savesList: 60 * 15,  // 15min
  save: 60 * 30,       // 30min
}

export async function listSaves(userId: string) {
  const key = `user:${userId}:saves`
  const cached = await cacheGet<ReturnType<typeof mapSaves>>(key)
  if (cached) return cached

  const saves = await prisma.save.findMany({
    where: { userId, deletedAt: null },
    include: {
      clubStints: {
        where: { isCurrent: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const result = mapSaves(saves)
  await cacheSet(key, result, TTL.savesList)
  return result
}

function mapSaves(saves: Awaited<ReturnType<typeof prisma.save.findMany<{ include: { clubStints: true } }>>>) {
  return saves.map(({ clubStints, ...rest }) => ({
    ...rest,
    budgetFormatted: formatBalance(rest.budget),
    balanceFormatted: formatBalance(rest.balance),
    currentClubStint: clubStints[0] ?? null,
  }))
}

export async function getSaveById(saveId: string, userId: string) {
  const key = `save:${saveId}`
  const cached = await cacheGet<object>(key)
  if (cached) return cached

  const result = await fetchSaveById(saveId, userId)
  await cacheSet(key, result, TTL.save)
  return result
}

async function fetchSaveById(saveId: string, userId: string) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: true },
  })

  if (!save) throw new NotFoundError('Save não encontrado.')
  if (save.userId !== userId) throw new NotFoundError('Save não encontrado.')
  if (save.deletedAt) throw new NotFoundError('Save não encontrado.')

  const currentStint = save.clubStints.find((cs) => cs.isCurrent) ?? null

  const teamStats = currentStint
    ? await prisma.teamSeasonStats.findMany({
        where: { clubStintId: currentStint.id },
        select: { season: true },
        distinct: ['season'],
        orderBy: { season: 'asc' },
      })
    : []

  const { clubStints, ...rest } = save
  return {
    ...rest,
    budgetFormatted: formatBalance(rest.budget),
    balanceFormatted: formatBalance(rest.balance),
    currentClubStint: currentStint,
    clubStints,
    availableSeasons: teamStats.map((s) => s.season),
  }
}

export async function createSave(data: {
  name: string
  club: string
  budget: number
  userId: string
  europeanCompetitionId?: string | null
}) {
  if (!clubExists(data.club)) {
    throw new AppError(`Clube inválido: '${data.club}' não encontrado na lista de clubes disponíveis.`, 400)
  }

  const league = findLeagueByClub(data.club)
  const country = league ? LEAGUE_TO_COUNTRY[league] : null
  const countryCompetitionIds = country ? await getCompetitionIdsByCountry(country) : []
  const allCompetitionIds = data.europeanCompetitionId
    ? [...countryCompetitionIds, data.europeanCompetitionId]
    : countryCompetitionIds

  const { newSave, clubStint } = await prisma.$transaction(async (tx) => {
    const newSave = await tx.save.create({
      data: {
        name: data.name,
        userId: data.userId,
        currentYear: 2025,
        currentSeason: '2025/26',
        budget: data.budget,
        balance: data.budget,
      },
    })

    const clubStint = await tx.clubStint.create({
      data: {
        saveId: newSave.id,
        club: data.club,
        startYear: '2025',
        isCurrent: true,
      },
    })

    if (allCompetitionIds.length > 0) {
      await tx.teamSeasonStats.createMany({
        data: allCompetitionIds.map((competitionId) => ({
          clubStintId: clubStint.id,
          season: '2025/26',
          competitionId,
        })),
        skipDuplicates: true,
      })
    }

    return { newSave, clubStint }
  })

  await cacheInvalidate(`user:${data.userId}:saves`)

  return {
    ...newSave,
    budgetFormatted: formatBalance(newSave.budget),
    balanceFormatted: formatBalance(newSave.balance),
    currentClubStint: clubStint,
    clubStints: [clubStint],
    availableSeasons: ['2025/26'],
  }
}

export async function updateSave(
  saveId: string,
  data: {
    currentYear?: number
    currentSeason?: string
    budget?: number
    balance?: number
    europeanCompetitionId?: string | null
  },
  userId: string
) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: {
      clubStints: {
        where: { isCurrent: true },
        include: {
          teamSeasonStats: {
            select: { season: true },
            orderBy: { season: 'asc' },
            distinct: ['season'],
          },
        },
      },
    },
  })

  if (!save) throw new NotFoundError('Save não encontrado.')
  if (save.userId !== userId) throw new NotFoundError('Save não encontrado.')
  if (save.deletedAt) throw new NotFoundError('Save não encontrado.')

  const seasonChanged = data.currentSeason && data.currentSeason !== save.currentSeason

  let txUpdatedSave: Save | null = null

  const { europeanCompetitionId, ...saveData } = data

  await prisma.$transaction(async (tx) => {
    if (seasonChanged && save.clubStints[0]) {
      const currentStint = save.clubStints[0]

      // Avanço de temporada é irreversível: tira um snapshot antes de qualquer mutação
      // (dentro da mesma transação, então é atômico com o avanço) e audita a ação.
      await createSnapshot(tx, saveId, userId, 'pre-season-advance')
      await writeAudit(tx, {
        userId,
        saveId,
        action: 'save.season_advance',
        meta: { from: save.currentSeason, to: data.currentSeason },
      })

      // Verificar se alguma competição da temporada que está encerrando teve campeão
      const endingStats = await tx.teamSeasonStats.findMany({
        where: { clubStintId: currentStint.id, season: save.currentSeason },
        include: { competition: true },
      })

      const trophyYear = save.currentYear

      await Promise.all(
        endingStats
          .filter((stat) => {
            if (!stat.competition) return false
            if (stat.competition.type === 'League') return stat.leaguePosition === 1
            return stat.cupResult === 'Campeao'
          })
          .map((stat) =>
            tx.trophy.upsert({
              where: {
                clubStintId_competitionId_year: {
                  clubStintId: currentStint.id,
                  competitionId: stat.competitionId!,
                  year: trophyYear,
                },
              },
              create: {
                clubStintId: currentStint.id,
                competitionId: stat.competitionId!,
                year: trophyYear,
              },
              update: {},
            })
          )
      )

      const activePlayers = await tx.player.findMany({
        where: { saveId, activeClubStintId: currentStint.id },
      })

      if (activePlayers.length > 0) {
        await tx.playerOvrHistory.createMany({
          data: activePlayers.map((p) => ({
            playerId: p.id,
            season: save.currentSeason,
            ovr: p.ovr,
            marketValue: p.marketValue,
          })),
          skipDuplicates: true,
        })
      }

      await tx.player.updateMany({
        where: { saveId, activeClubStintId: currentStint.id, age: { lt: 45 } },
        data: { age: { increment: 1 } },
      })

      // Criar TeamSeasonStats para a nova temporada (uma por competição do país + europeia opcional)
      const league = findLeagueByClub(currentStint.club)
      const country = league ? LEAGUE_TO_COUNTRY[league] : null
      const countryCompetitionIds = country ? await getCompetitionIdsByCountry(country) : []
      const newSeasonCompetitionIds = europeanCompetitionId
        ? [...countryCompetitionIds, europeanCompetitionId]
        : countryCompetitionIds

      if (newSeasonCompetitionIds.length > 0) {
        await tx.teamSeasonStats.createMany({
          data: newSeasonCompetitionIds.map((competitionId) => ({
            clubStintId: currentStint.id,
            season: data.currentSeason!,
            competitionId,
          })),
          skipDuplicates: true,
        })
      }

      if (activePlayers.length > 0) {
        await tx.playerSeasonStats.createMany({
          data: activePlayers.map((p) => ({
            playerId: p.id,
            clubStintId: currentStint.id,
            season: data.currentSeason!,
          })),
          skipDuplicates: true,
        })
      }

      const loanedPlayers = await tx.player.findMany({
        where: {
          saveId,
          status: PlayerStatus.Loan,
          activeClubStintId: null,
          transfers: {
            some: {
              type: TransferType.emprestimo_saida,
              clubStintId: currentStint.id,
            },
          },
        },
      })
      if (loanedPlayers.length > 0) {
        await tx.player.updateMany({
          where: { id: { in: loanedPlayers.map((p) => p.id) } },
          data: { activeClubStintId: currentStint.id, status: PlayerStatus.Role },
        })
        await tx.playerSeasonStats.createMany({
          data: loanedPlayers.map((p) => ({
            playerId: p.id,
            clubStintId: currentStint.id,
            season: data.currentSeason!,
          })),
          skipDuplicates: true,
        })
      }

      if (data.budget !== undefined) {
        saveData.balance = data.budget
      }
    }

    txUpdatedSave = await tx.save.update({ where: { id: saveId }, data: saveData })

    // Edição direta de dinheiro (fora do avanço de temporada): registra antes→depois no
    // audit para rastreio e eventual reversão manual. Avanço já é auditado como season_advance.
    if (!seasonChanged) {
      const financeMeta: Record<string, { from: number | null; to: number }> = {}
      if (data.budget !== undefined && data.budget !== save.budget) {
        financeMeta.budget = { from: save.budget, to: data.budget }
      }
      if (data.balance !== undefined && data.balance !== save.balance) {
        financeMeta.balance = { from: save.balance, to: data.balance }
      }
      if (Object.keys(financeMeta).length > 0) {
        await writeAudit(tx, { userId, saveId, action: 'save.finance_edit', meta: financeMeta })
      }
    }
  })

  if (seasonChanged) {
    await cacheInvalidatePattern(`save:${saveId}:*`)
  }
  await cacheInvalidate(`save:${saveId}`, `user:${userId}:saves`)

  const updatedSave = txUpdatedSave!
  const currentStint = save.clubStints[0] ?? null
  const existingSeasons = new Set(currentStint?.teamSeasonStats.map((s) => s.season) ?? [])
  const availableSeasons = seasonChanged
    ? [...existingSeasons, data.currentSeason!]
    : [...existingSeasons]

  return {
    id: updatedSave.id,
    userId: updatedSave.userId,
    name: updatedSave.name,
    currentYear: updatedSave.currentYear,
    currentSeason: updatedSave.currentSeason,
    budget: updatedSave.budget,
    balance: updatedSave.balance,
    createdAt: updatedSave.createdAt,
    updatedAt: updatedSave.updatedAt,
    budgetFormatted: formatBalance(updatedSave.budget),
    balanceFormatted: formatBalance(updatedSave.balance),
    currentClubStint: currentStint,
    availableSeasons,
  }
}

/**
 * Lista os saves arquivados (soft-deleted) do usuário, para a "lixeira"/recuperação.
 */
export async function listDeletedSaves(userId: string) {
  const saves = await prisma.save.findMany({
    where: { userId, deletedAt: { not: null } },
    orderBy: { deletedAt: 'desc' },
  })
  return saves.map((s) => ({
    ...s,
    budgetFormatted: formatBalance(s.budget),
    balanceFormatted: formatBalance(s.balance),
  }))
}

/**
 * Deleta um save. Por padrão é SOFT (marca `deletedAt`, reversível) e tira um snapshot
 * `pre-delete`. Com `purge: true` apaga de vez (cascade + snapshots) — terminal.
 * Exige `confirm === saveId` em ambos os casos para evitar chamada acidental.
 */
export async function deleteSave(
  saveId: string,
  userId: string,
  opts: { confirm?: string; purge?: boolean } = {}
) {
  const save = await prisma.save.findUnique({ where: { id: saveId } })
  if (!save) throw new NotFoundError('Save não encontrado.')
  if (save.userId !== userId) throw new NotFoundError('Save não encontrado.')

  if (opts.confirm !== saveId) {
    throw new AppError(
      'Confirmação necessária: envie ?confirm=<saveId> para deletar.',
      400,
      'DELETE_CONFIRMATION_REQUIRED'
    )
  }

  if (opts.purge) {
    await prisma.$transaction(async (tx) => {
      // Audita ANTES (o AuditLog não tem FK ao save, então sobrevive ao purge).
      await writeAudit(tx, { userId, saveId, action: 'save.purge', meta: { name: save.name } })
      await tx.save.delete({ where: { id: saveId } })
    })
    await cacheInvalidatePattern(`save:${saveId}:*`)
    await cacheInvalidate(`save:${saveId}`, `user:${userId}:saves`)
    return { purged: true as const }
  }

  // Soft-delete: snapshot de segurança + marca deletedAt, tudo atômico.
  if (save.deletedAt) return { purged: false as const, deletedAt: save.deletedAt }
  await prisma.$transaction(async (tx) => {
    await createSnapshot(tx, saveId, userId, 'pre-delete')
    await writeAudit(tx, { userId, saveId, action: 'save.soft_delete', meta: { name: save.name } })
    await tx.save.update({ where: { id: saveId }, data: { deletedAt: new Date() } })
  })
  await cacheInvalidatePattern(`save:${saveId}:*`)
  await cacheInvalidate(`save:${saveId}`, `user:${userId}:saves`)
  return { purged: false as const }
}

/**
 * Des-arquiva um save soft-deleted (limpa `deletedAt`). Recuperação simples do caso
 * "deletei sem querer" — os dados não foram alterados pelo soft-delete. Para reverter um
 * avanço de temporada use o restore por snapshot.
 */
export async function restoreSave(saveId: string, userId: string) {
  const save = await prisma.save.findUnique({ where: { id: saveId } })
  if (!save) throw new NotFoundError('Save não encontrado.')
  if (save.userId !== userId) throw new NotFoundError('Save não encontrado.')
  if (!save.deletedAt) throw new AppError('Save não está arquivado.', 400)

  await prisma.$transaction(async (tx) => {
    await tx.save.update({ where: { id: saveId }, data: { deletedAt: null } })
    await writeAudit(tx, { userId, saveId, action: 'save.restore' })
  })
  await cacheInvalidate(`save:${saveId}`, `user:${userId}:saves`)
}
