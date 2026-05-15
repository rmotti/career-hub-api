import { prisma } from '../shared/lib/prisma.js'

export async function resolveSaveId(userId: string, given: string | undefined): Promise<string | null> {
  if (given) return given
  const save = await prisma.save.findFirst({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  })
  return save?.id ?? null
}
