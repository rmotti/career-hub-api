import { prisma } from '../../shared/lib/prisma.js'
import { AppError, NotFoundError } from '../../shared/utils/errors.js'
import { clubExists } from '../clubs/clubs.service.js'

export async function listClubStints(saveId: string) {
  const save = await prisma.save.findUnique({ where: { id: saveId } })
  if (!save) throw new NotFoundError('Save não encontrado.')

  return prisma.clubStint.findMany({
    where: { saveId },
    orderBy: { createdAt: 'asc' },
  })
}

export async function getCurrentClubStint(saveId: string) {
  const save = await prisma.save.findUnique({ where: { id: saveId } })
  if (!save) throw new NotFoundError('Save não encontrado.')

  const stint = await prisma.clubStint.findFirst({
    where: { saveId, isCurrent: true },
  })

  if (!stint) throw new NotFoundError('Nenhum clube ativo encontrado para este save.')

  return stint
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

  return prisma.clubStint.update({
    where: { id: stintId },
    data,
  })
}
