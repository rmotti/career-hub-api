import { prisma } from '../../shared/lib/prisma.js'
import { AppError, NotFoundError } from '../../shared/utils/errors.js'
import { cacheGet, cacheSet, cacheInvalidate } from '../../shared/utils/cache.js'

const TTL_TROPHIES = 60 * 60 // 1h

export async function listTrophies(saveId: string) {
  const key = `save:${saveId}:trophies`
  const cached = await cacheGet<unknown[]>(key)
  if (cached) return cached

  const result = await fetchTrophies(saveId)
  await cacheSet(key, result, TTL_TROPHIES)
  return result
}

async function fetchTrophies(saveId: string) {
  const [save, trophies] = await Promise.all([
    prisma.save.findUnique({ where: { id: saveId }, select: { id: true } }),
    prisma.trophy.findMany({
      where: { clubStint: { saveId } },
      include: {
        clubStint: { select: { club: true } },
        competition: true,
      },
      orderBy: { year: 'desc' },
    }),
  ])
  if (!save) throw new NotFoundError('Save não encontrado.')

  return trophies.map((t) => ({
    id: t.id,
    year: t.year,
    createdAt: t.createdAt,
    clubStintId: t.clubStintId,
    club: t.clubStint.club,
    competition: t.competition
      ? { id: t.competition.id, name: t.competition.name, type: t.competition.type }
      : null,
  }))
}

export async function createTrophy(
  saveId: string,
  data: { competitionId: string; year: number }
) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: { where: { isCurrent: true } } },
  })
  if (!save) throw new NotFoundError('Save não encontrado.')

  const currentStint = save.clubStints[0]
  if (!currentStint) throw new AppError('Não é possível adicionar troféu: nenhum clube ativo encontrado.', 400)

  const competition = await prisma.competition.findUnique({ where: { id: data.competitionId } })
  if (!competition) throw new AppError('Competição não encontrada.', 400)

  const result = await prisma.trophy.create({
    data: {
      clubStintId: currentStint.id,
      competitionId: data.competitionId,
      year: data.year,
    },
    include: { competition: true },
  })

  await cacheInvalidate(`save:${saveId}:trophies`)

  // Mesma forma que listTrophies — contrato único entre criação e listagem.
  return {
    id: result.id,
    year: result.year,
    createdAt: result.createdAt,
    clubStintId: result.clubStintId,
    club: currentStint.club,
    competition: result.competition
      ? { id: result.competition.id, name: result.competition.name, type: result.competition.type }
      : null,
  }
}

export async function deleteTrophy(saveId: string, id: string) {
  const trophy = await prisma.trophy.findFirst({
    where: { id, clubStint: { saveId } },
  })
  if (!trophy) throw new NotFoundError('Troféu não encontrado.')

  await prisma.trophy.delete({ where: { id } })
  await cacheInvalidate(`save:${saveId}:trophies`)
}
