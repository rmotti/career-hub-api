import { prisma } from '../../shared/lib/prisma.js'
import { AppError, NotFoundError } from '../../shared/utils/errors.js'
import { CupResult } from '@prisma/client'
import { cacheGet, cacheSet, cacheInvalidate } from '../../shared/utils/cache.js'

const TTL_TEAM_STATS = 60 * 60 // 1h

export async function listTeamStats(saveId: string, seasonFilter?: string) {
  const key = seasonFilter
    ? `save:${saveId}:team-stats:${seasonFilter}`
    : `save:${saveId}:team-stats`

  const cached = await cacheGet<unknown[]>(key)
  if (cached) return cached

  const result = await fetchTeamStats(saveId, seasonFilter)
  await cacheSet(key, result, TTL_TEAM_STATS)
  return result
}

async function fetchTeamStats(saveId: string, seasonFilter?: string) {
  const [save, allStats] = await Promise.all([
    prisma.save.findUnique({
      where: { id: saveId },
      include: { clubStints: { where: { isCurrent: true } } },
    }),
    !seasonFilter
      ? prisma.teamSeasonStats.findMany({
          where: { clubStint: { saveId }, competitionId: { not: null }, competition: { isNot: null } },
          include: {
            clubStint: { select: { club: true } },
            competition: true,
          },
          orderBy: [{ season: 'asc' }, { createdAt: 'asc' }],
        })
      : Promise.resolve(null),
  ])
  if (!save) throw new NotFoundError('Save não encontrado.')

  if (seasonFilter) {
    const currentStint = save.clubStints[0]
    if (!currentStint) throw new NotFoundError('Nenhum clube ativo encontrado para este save.')

    const targetSeason = seasonFilter === 'current' ? save.currentSeason : seasonFilter

    const stats = await prisma.teamSeasonStats.findMany({
      where: { clubStintId: currentStint.id, season: targetSeason, competitionId: { not: null }, competition: { isNot: null } },
      include: { competition: true },
      orderBy: { createdAt: 'asc' },
    })

    if (!stats.length) throw new NotFoundError(`Estatísticas não encontradas para a temporada ${targetSeason}.`)

    return stats
  }

  return allStats!
}

export async function addTeamStat(
  saveId: string,
  data: { competitionId: string; season?: string; clubStintId?: string }
) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: { where: { isCurrent: true } } },
  })
  if (!save) throw new NotFoundError('Save não encontrado.')

  // Resolve o stint alvo: o informado (validado contra o save) ou o atual.
  let clubStintId = data.clubStintId
  if (clubStintId) {
    const stint = await prisma.clubStint.findFirst({
      where: { id: clubStintId, saveId },
      select: { id: true },
    })
    if (!stint) throw new NotFoundError('Passagem de clube não encontrada.')
  } else {
    const currentStint = save.clubStints[0]
    if (!currentStint) throw new NotFoundError('Nenhum clube ativo encontrado para este save.')
    clubStintId = currentStint.id
  }

  const competition = await prisma.competition.findUnique({
    where: { id: data.competitionId },
    select: { id: true },
  })
  if (!competition) throw new AppError('Competição inválida.', 400)

  const season = data.season ?? save.currentSeason

  const existing = await prisma.teamSeasonStats.findFirst({
    where: { clubStintId, competitionId: data.competitionId, season },
    select: { id: true },
  })
  if (existing) throw new AppError('Esta competição já está registrada para este clube nesta temporada.', 409)

  const result = await prisma.teamSeasonStats.create({
    data: { clubStintId, competitionId: data.competitionId, season },
    include: { competition: true },
  })

  await cacheInvalidate(
    `save:${saveId}:team-stats`,
    `save:${saveId}:team-stats:${season}`,
    `save:${saveId}:team-stats:current`,
  )

  return result
}

export async function removeTeamStat(saveId: string, statsId: string) {
  const stats = await prisma.teamSeasonStats.findFirst({
    where: { id: statsId, clubStint: { saveId } },
    select: { id: true, season: true },
  })
  if (!stats) throw new NotFoundError('Estatísticas não encontradas.')

  await prisma.teamSeasonStats.delete({ where: { id: statsId } })

  await cacheInvalidate(
    `save:${saveId}:team-stats`,
    `save:${saveId}:team-stats:${stats.season}`,
    `save:${saveId}:team-stats:current`,
  )
}

export async function updateTeamStats(
  saveId: string,
  statsId: string,
  data: {
    goalsPro?: number
    goalsAgainst?: number
    wins?: number
    draws?: number
    losses?: number
    leaguePosition?: number
    cupResult?: CupResult
  }
) {
  if (data.leaguePosition !== undefined && data.leaguePosition < 1) {
    throw new AppError('A posição na liga deve ser um número maior que zero.', 400)
  }

  const validCupResults = Object.values(CupResult)
  if (data.cupResult && !validCupResults.includes(data.cupResult)) {
    throw new AppError(`Resultado de copa inválido. Valores aceitos: ${validCupResults.join(', ')}.`, 400)
  }

  const stats = await prisma.teamSeasonStats.findFirst({
    where: { id: statsId, clubStint: { saveId } },
  })

  if (!stats) throw new NotFoundError('Estatísticas não encontradas.')

  const result = await prisma.teamSeasonStats.update({
    where: { id: statsId },
    data,
    include: { competition: true },
  })

  await cacheInvalidate(
    `save:${saveId}:team-stats`,
    `save:${saveId}:team-stats:${stats.season}`,
    `save:${saveId}:team-stats:current`,
  )

  return result
}
