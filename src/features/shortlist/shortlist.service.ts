import { ShortlistPriority } from '@prisma/client'
import { prisma } from '../../shared/lib/prisma.js'
import { AppError, NotFoundError } from '../../shared/utils/errors.js'

export interface ShortlistCreateInput {
  fc26PlayerId: number
  notes?: string | null
  priority?: ShortlistPriority | null
}

export interface ShortlistUpdateInput {
  notes?: string | null
  priority?: ShortlistPriority | null
}

export async function listShortlist(saveId: string, userId: string) {
  await assertSaveAccess(saveId, userId)

  const items = await prisma.shortlistItem.findMany({
    where: { saveId },
    orderBy: { createdAt: 'desc' },
    include: {
      fc26Player: {
        select: {
          id: true,
          sofifaId: true,
          name: true,
          longName: true,
          age: true,
          ovr: true,
          potential: true,
          positions: true,
          nation: true,
          club: true,
          league: true,
          marketValue: true,
          wage: true,
          playerFaceUrl: true,
        },
      },
    },
  })

  return items
}

export async function addShortlistItem(saveId: string, input: ShortlistCreateInput, userId: string) {
  await assertSaveAccess(saveId, userId)

  const exists = await prisma.fc26Player.findUnique({ where: { id: input.fc26PlayerId }, select: { id: true } })
  if (!exists) throw new NotFoundError('Jogador FC26 não encontrado.')

  const duplicate = await prisma.shortlistItem.findUnique({
    where: { saveId_fc26PlayerId: { saveId, fc26PlayerId: input.fc26PlayerId } },
  })
  if (duplicate) throw new AppError('Jogador já está na shortlist deste save.', 409)

  return prisma.shortlistItem.create({
    data: {
      saveId,
      fc26PlayerId: input.fc26PlayerId,
      notes: normalizeNotes(input.notes),
      priority: input.priority ?? null,
    },
  })
}

export async function updateShortlistItem(
  saveId: string,
  itemId: string,
  input: ShortlistUpdateInput,
  userId: string
) {
  await assertSaveAccess(saveId, userId)

  const existing = await prisma.shortlistItem.findFirst({ where: { id: itemId, saveId } })
  if (!existing) throw new NotFoundError('Item da shortlist não encontrado.')

  return prisma.shortlistItem.update({
    where: { id: itemId },
    data: {
      ...(input.notes !== undefined ? { notes: normalizeNotes(input.notes) } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    },
  })
}

export async function removeShortlistItem(saveId: string, itemId: string, userId: string) {
  await assertSaveAccess(saveId, userId)

  const existing = await prisma.shortlistItem.findFirst({ where: { id: itemId, saveId } })
  if (!existing) throw new NotFoundError('Item da shortlist não encontrado.')

  await prisma.shortlistItem.delete({ where: { id: itemId } })
}

async function assertSaveAccess(saveId: string, userId: string) {
  const save = await prisma.save.findFirst({ where: { id: saveId, userId }, select: { id: true } })
  if (!save) throw new NotFoundError('Save não encontrado.')
}

function normalizeNotes(notes?: string | null) {
  if (notes === undefined) return undefined
  if (notes === null) return null
  const trimmed = notes.trim()
  if (!trimmed) return null
  if (trimmed.length > 500) throw new AppError('Notas devem ter no máximo 500 caracteres.', 400)
  return trimmed
}
