import { prisma } from '../lib/prisma'
import { AppError, NotFoundError } from '../utils/errors'

export async function listTrophies(saveId: string) {
  const save = await prisma.save.findUnique({ where: { id: saveId } })
  if (!save) throw new NotFoundError('Save não encontrado.')

  const trophies = await prisma.trophy.findMany({
    where: { clubStint: { saveId } },
    include: { clubStint: { select: { club: true } } },
    orderBy: { year: 'desc' },
  })

  return trophies.map((t: (typeof trophies)[number]) => ({
    id: t.id,
    name: t.name,
    year: t.year,
    createdAt: t.createdAt,
    clubStintId: t.clubStintId,
    club: t.clubStint.club,
  }))
}

export async function createTrophy(
  saveId: string,
  data: { name: string; year: number }
) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: { where: { isCurrent: true } } },
  })
  if (!save) throw new NotFoundError('Save não encontrado.')

  const currentStint = save.clubStints[0]
  if (!currentStint) throw new AppError('Não é possível adicionar troféu: nenhum clube ativo encontrado.', 400)

  return prisma.trophy.create({
    data: {
      clubStintId: currentStint.id,
      ...data,
    },
  })
}

export async function deleteTrophy(saveId: string, id: string) {
  const trophy = await prisma.trophy.findFirst({
    where: { id, clubStint: { saveId } },
  })
  if (!trophy) throw new NotFoundError('Troféu não encontrado.')

  await prisma.trophy.delete({ where: { id } })
}
