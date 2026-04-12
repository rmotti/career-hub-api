import { prisma } from '../../shared/lib/prisma.js'
import { AppError, NotFoundError } from '../../shared/utils/errors.js'
import { CupResult } from '@prisma/client'
import { cacheGet, cacheSet, cacheInvalidate, cacheInvalidatePattern } from '../../shared/utils/cache.js'

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
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: { where: { isCurrent: true } } },
  })
  if (!save) throw new NotFoundError('Save não encontrado.')

  if (seasonFilter) {
    const currentStint = save.clubStints[0]
    if (!currentStint) throw new NotFoundError('Nenhum clube ativo encontrado para este save.')

    const targetSeason = seasonFilter === 'current' ? save.currentSeason : seasonFilter

    let stats = await prisma.teamSeasonStats.findUnique({
      where: { clubStintId_season: { clubStintId: currentStint.id, season: targetSeason } },
    })

    if (!stats && seasonFilter === 'current') {
      stats = await prisma.teamSeasonStats.upsert({
        where: { clubStintId_season: { clubStintId: currentStint.id, season: targetSeason } },
        create: { clubStintId: currentStint.id, season: targetSeason },
        update: {},
      })
    }

    if (!stats) throw new NotFoundError(`Estatísticas não encontradas para a temporada ${targetSeason}.`)

    return [stats]
  }

  return prisma.teamSeasonStats.findMany({
    where: { clubStint: { saveId } },
    include: { clubStint: { select: { club: true } } },
    orderBy: { createdAt: 'asc' },
  })
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
    europeanCupResult?: CupResult
    nationalCupResult?: CupResult
  }
) {
  if (data.leaguePosition !== undefined && data.leaguePosition < 1) {
    throw new AppError('A posição na liga deve ser um número maior que zero.', 400)
  }

  const validCupResults = Object.values(CupResult)
  if (data.europeanCupResult && !validCupResults.includes(data.europeanCupResult)) {
    throw new AppError(`Resultado de copa inválido. Valores aceitos: ${validCupResults.join(', ')}.`, 400)
  }
  if (data.nationalCupResult && !validCupResults.includes(data.nationalCupResult)) {
    throw new AppError(`Resultado de copa inválido. Valores aceitos: ${validCupResults.join(', ')}.`, 400)
  }

  const stats = await prisma.teamSeasonStats.findFirst({
    where: { id: statsId, clubStint: { saveId } },
  })

  if (!stats) throw new NotFoundError('Estatísticas não encontradas.')

  const result = await prisma.teamSeasonStats.update({ where: { id: statsId }, data })

  await cacheInvalidate(`save:${saveId}:team-stats`)
  await cacheInvalidatePattern(`save:${saveId}:team-stats:*`)

  return result
}
