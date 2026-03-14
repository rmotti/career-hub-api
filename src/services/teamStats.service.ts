import { prisma } from '../lib/prisma'
import { AppError, NotFoundError } from '../utils/errors'

type CupResult = 'Campeao' | 'Final' | 'Semifinal' | 'Quartas' | 'OitavasOuFaseDeGrupos' | 'Eliminado' | 'NaoParticipou'

export async function listTeamStats(saveId: string, seasonFilter?: string) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: { where: { isCurrent: true } } },
  })
  if (!save) throw new NotFoundError('Save não encontrado.')

  if (seasonFilter === 'current') {
    const currentStint = save.clubStints[0]
    if (!currentStint) throw new NotFoundError('Nenhum clube ativo encontrado para este save.')

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
    leaguePosition?: number
    europeanCupResult?: CupResult
    nationalCupResult?: CupResult
  }
) {
  if (data.possession !== undefined && (data.possession < 0 || data.possession > 100)) {
    throw new AppError("O campo 'possession' deve ser um valor entre 0 e 100.", 400)
  }

  if (data.leaguePosition !== undefined && data.leaguePosition < 1) {
    throw new AppError('A posição na liga deve ser um número maior que zero.', 400)
  }

  const validCupResults: CupResult[] = ['Campeao', 'Final', 'Semifinal', 'Quartas', 'OitavasOuFaseDeGrupos', 'Eliminado', 'NaoParticipou']
  if (data.europeanCupResult && !validCupResults.includes(data.europeanCupResult)) {
    throw new AppError('Resultado de copa inválido. Valores aceitos: Campeao, Final, Semifinal, Quartas, OitavasOuFaseDeGrupos, Eliminado, NaoParticipou.', 400)
  }
  if (data.nationalCupResult && !validCupResults.includes(data.nationalCupResult)) {
    throw new AppError('Resultado de copa inválido. Valores aceitos: Campeao, Final, Semifinal, Quartas, OitavasOuFaseDeGrupos, Eliminado, NaoParticipou.', 400)
  }

  const stats = await prisma.teamSeasonStats.findFirst({
    where: { id: statsId, clubStint: { saveId } },
  })

  if (!stats) throw new NotFoundError('Estatísticas não encontradas.')

  return prisma.teamSeasonStats.update({ where: { id: statsId }, data })
}
