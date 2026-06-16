import { prisma } from '../../shared/lib/prisma.js'
import { AppError, NotFoundError } from '../../shared/utils/errors.js'
import { clubExists, findLeagueByClub, LEAGUE_TO_COUNTRY } from '../clubs/clubs.service.js'
import { cacheGet, cacheSet, cacheInvalidate } from '../../shared/utils/cache.js'
import { createSnapshot, writeAudit } from '../saves/snapshots.service.js'
import { invalidatePlayersCache } from '../players/players.service.js'

const TTL_CLUB_STINTS = 60 * 60 // 1h

export async function listClubStints(saveId: string) {
  const key = `save:${saveId}:club-stints`
  const cached = await cacheGet<object[]>(key)
  if (cached) return cached

  const stints = await prisma.clubStint.findMany({
    where: { saveId },
    orderBy: { createdAt: 'asc' },
  })

  // Check the save exists only when there are no stints (avoids an extra query on the happy path)
  if (stints.length === 0) {
    const save = await prisma.save.findUnique({ where: { id: saveId }, select: { id: true } })
    if (!save) throw new NotFoundError('Save não encontrado.')
  }

  await cacheSet(key, stints, TTL_CLUB_STINTS)
  return stints
}

export async function getCurrentClubStint(saveId: string) {
  // Reuse the list cache to avoid an extra query
  const stints = await listClubStints(saveId)
  const current = (stints as Array<{ isCurrent: boolean }>).find((s) => s.isCurrent)
  if (!current) throw new NotFoundError('Nenhum clube ativo encontrado para este save.')
  return current
}

export async function createClubStint(saveId: string, data: { club: string; europeanCompetitionId?: string | null }, userId: string) {
  if (!clubExists(data.club)) {
    throw new AppError(`Clube inválido: '${data.club}' não encontrado na lista de clubes disponíveis.`, 400)
  }

  const save = await prisma.save.findUnique({ where: { id: saveId } })
  if (!save) throw new NotFoundError('Save não encontrado.')

  if (data.europeanCompetitionId) {
    const europeanCompetition = await prisma.competition.findFirst({
      where: { id: data.europeanCompetitionId, type: 'EuropeanCup' },
      select: { id: true },
    })
    if (!europeanCompetition) throw new AppError('Competição europeia inválida.', 400)
  }

  const league = findLeagueByClub(data.club)
  const country = league ? LEAGUE_TO_COUNTRY[league] : null

  const currentStint = await prisma.clubStint.findFirst({
    where: { saveId, isCurrent: true },
  })

  const newStint = await prisma.$transaction(async (tx) => {
    // Changing clubs is destructive (detaches the whole squad): safety snapshot +
    // audit before any mutation, atomic with the change. Undo via the snapshot restore.
    await createSnapshot(tx, saveId, userId, 'pre-club-change')
    await writeAudit(tx, {
      userId,
      saveId,
      action: 'clubstint.change',
      meta: { from: currentStint?.club ?? null, to: data.club, season: save.currentSeason },
    })

    const [countryCompetitions, currentEuropeanStats] = await Promise.all([
      country
        ? tx.competition.findMany({
            where: { country },
            select: { id: true },
          })
        : Promise.resolve([]),
      currentStint && !data.europeanCompetitionId
        ? tx.teamSeasonStats.findMany({
            where: {
              clubStintId: currentStint.id,
              season: save.currentSeason,
              competition: { is: { type: 'EuropeanCup' } },
            },
            select: { competitionId: true },
          })
        : Promise.resolve([]),
    ])

    const competitionIds = [
      ...countryCompetitions.map((competition) => competition.id),
      ...(data.europeanCompetitionId
        ? [data.europeanCompetitionId]
        : currentEuropeanStats.flatMap((stats) => stats.competitionId ? [stats.competitionId] : [])),
    ]
    const uniqueCompetitionIds = [...new Set(competitionIds)]

    if (currentStint) {
      await tx.clubStint.update({
        where: { id: currentStint.id },
        data: {
          isCurrent: false,
          endYear: String(save.currentYear),
        },
      })

      await tx.player.updateMany({
        where: { saveId, activeClubStintId: currentStint.id },
        data: { activeClubStintId: null },
      })
    }

    const stint = await tx.clubStint.create({
      data: {
        saveId,
        club: data.club,
        startYear: String(save.currentYear),
        isCurrent: true,
      },
    })

    if (uniqueCompetitionIds.length > 0) {
      await tx.teamSeasonStats.createMany({
        data: uniqueCompetitionIds.map((competitionId) => ({
          clubStintId: stint.id,
          season: save.currentSeason,
          competitionId,
        })),
        skipDuplicates: true,
      })
    }

    return stint
  })

  await cacheInvalidate(
    `save:${saveId}:club-stints`,
    `save:${saveId}:transfers`,
    `save:${saveId}:transfers:current`,
    `save:${saveId}:team-stats`,
    `save:${saveId}:team-stats:${save.currentSeason}`,
    `save:${saveId}:team-stats:current`,
  )
  // Changing clubs detaches the whole squad — invalidate every player key
  // (includes loaned and historical seasons, which the manual list didn't cover).
  await invalidatePlayersCache(saveId)

  return newStint
}

export async function updateClubStint(
  saveId: string,
  stintId: string,
  data: { club?: string; startYear?: string; endYear?: string }
) {
  const stint = await prisma.clubStint.findFirst({
    where: { id: stintId, saveId },
  })

  if (!stint) throw new NotFoundError('Passagem de clube não encontrada.')

  if (data.club && !clubExists(data.club)) {
    throw new AppError(`Clube inválido: '${data.club}' não encontrado na lista de clubes disponíveis.`, 400)
  }

  const result = await prisma.clubStint.update({
    where: { id: stintId },
    data,
  })

  await cacheInvalidate(`save:${saveId}:club-stints`)

  return result
}
