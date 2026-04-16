import { prisma } from '../../shared/lib/prisma.js'
import { AppError, NotFoundError } from '../../shared/utils/errors.js'
import { clubExists } from '../clubs/clubs.service.js'
import { cacheGet, cacheSet, cacheInvalidate } from '../../shared/utils/cache.js'

const TTL_CLUB_STINTS = 60 * 60 // 1h

export async function listClubStints(saveId: string) {
  const key = `save:${saveId}:club-stints`
  const cached = await cacheGet<object[]>(key)
  if (cached) return cached

  const stints = await prisma.clubStint.findMany({
    where: { saveId },
    orderBy: { createdAt: 'asc' },
  })

  // Verificar existência do save somente quando não há stints (evita query extra no caminho feliz)
  if (stints.length === 0) {
    const save = await prisma.save.findUnique({ where: { id: saveId }, select: { id: true } })
    if (!save) throw new NotFoundError('Save não encontrado.')
  }

  await cacheSet(key, stints, TTL_CLUB_STINTS)
  return stints
}

export async function getCurrentClubStint(saveId: string) {
  // Reutiliza o cache da lista para evitar query extra
  const stints = await listClubStints(saveId)
  const current = (stints as Array<{ isCurrent: boolean }>).find((s) => s.isCurrent)
  if (!current) throw new NotFoundError('Nenhum clube ativo encontrado para este save.')
  return current
}

export async function createClubStint(saveId: string, data: { club: string }) {
  if (!clubExists(data.club)) {
    throw new AppError(`Clube inválido: '${data.club}' não encontrado na lista de clubes disponíveis.`, 400)
  }

  const save = await prisma.save.findUnique({ where: { id: saveId } })
  if (!save) throw new NotFoundError('Save não encontrado.')

  const currentStint = await prisma.clubStint.findFirst({
    where: { saveId, isCurrent: true },
  })

  const newStint = await prisma.$transaction(async (tx) => {
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

    await tx.teamSeasonStats.create({
      data: {
        clubStintId: stint.id,
        season: save.currentSeason,
      },
    })

    return stint
  })

  await cacheInvalidate(`save:${saveId}:club-stints`)

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
