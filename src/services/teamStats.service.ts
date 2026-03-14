import { prisma } from '../lib/prisma'
import { AppError, NotFoundError } from '../utils/errors'

export async function listTeamStats(saveId: string, seasonFilter?: string) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: { where: { isCurrent: true } } },
  })
  if (!save) throw new NotFoundError('Save not found')

  if (seasonFilter === 'current') {
    const currentStint = save.clubStints[0]
    if (!currentStint) throw new NotFoundError('No current club stint')

    const stats = await prisma.teamSeasonStats.findFirst({
      where: { clubStintId: currentStint.id, season: save.currentSeason },
    })

    return stats
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
    possession?: number
    wins?: number
    draws?: number
    losses?: number
  }
) {
  if (data.possession !== undefined && (data.possession < 0 || data.possession > 100)) {
    throw new AppError('Possession must be between 0 and 100', 400)
  }

  const stats = await prisma.teamSeasonStats.findFirst({
    where: { id: statsId, clubStint: { saveId } },
  })

  if (!stats) throw new NotFoundError('Team stats not found')

  return prisma.teamSeasonStats.update({ where: { id: statsId }, data })
}
