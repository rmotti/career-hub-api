import { prisma } from '../../shared/lib/prisma.js'
import { AppError, NotFoundError } from '../../shared/utils/errors.js'
import { clubExists, findLeagueByClub, LEAGUE_TO_COUNTRY } from '../clubs/clubs.service.js'
import { getCompetitionIdsByCountry } from '../competitions/competitions.service.js'
import { formatBalance } from '../../shared/utils/currency.js'
import { PlayerStatus, TransferType, type Save } from '@prisma/client'
import { cacheGet, cacheSet, cacheInvalidate, cacheInvalidatePattern } from '../../shared/utils/cache.js'

const TTL = {
  savesList: 60 * 15,  // 15min
  save: 60 * 30,       // 30min
}

export async function listSaves(userId: string) {
  const key = `user:${userId}:saves`
  const cached = await cacheGet<ReturnType<typeof mapSaves>>(key)
  if (cached) return cached

  const saves = await prisma.save.findMany({
    where: { userId },
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

  const seasonChanged = data.currentSeason && data.currentSeason !== save.currentSeason

  let txUpdatedSave: Save | null = null

  const { europeanCompetitionId, ...saveData } = data

  await prisma.$transaction(async (tx) => {
    if (seasonChanged && save.clubStints[0]) {
      const currentStint = save.clubStints[0]

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

export async function deleteSave(saveId: string, userId: string) {
  const save = await prisma.save.findUnique({ where: { id: saveId } })
  if (!save) throw new NotFoundError('Save não encontrado.')
  if (save.userId !== userId) throw new NotFoundError('Save não encontrado.')

  await prisma.save.delete({ where: { id: saveId } })
  await cacheInvalidatePattern(`save:${saveId}:*`)
  await cacheInvalidate(`save:${saveId}`, `user:${userId}:saves`)
}
