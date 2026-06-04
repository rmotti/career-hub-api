import { Prisma } from '@prisma/client'
import { prisma } from '../../shared/lib/prisma.js'
import { AppError, NotFoundError } from '../../shared/utils/errors.js'
import { assertSaveAccess } from '../../shared/utils/save-access.js'

export interface SavedSearchCreateInput {
  name: string
  filters: Record<string, unknown>
}

export interface SavedSearchUpdateInput {
  name?: string
  filters?: Record<string, unknown>
}

export async function listSavedSearches(saveId: string, userId: string) {
  await assertSaveAccess(saveId, userId)

  return prisma.savedSearch.findMany({
    where: { saveId },
    orderBy: { updatedAt: 'desc' },
  })
}

export async function createSavedSearch(saveId: string, input: SavedSearchCreateInput, userId: string) {
  await assertSaveAccess(saveId, userId)

  return prisma.savedSearch.create({
    data: {
      saveId,
      name: normalizeName(input.name),
      filters: normalizeFilters(input.filters),
    },
  })
}

export async function updateSavedSearch(
  saveId: string,
  id: string,
  input: SavedSearchUpdateInput,
  userId: string
) {
  await assertSaveAccess(saveId, userId)

  const existing = await prisma.savedSearch.findFirst({ where: { id, saveId } })
  if (!existing) throw new NotFoundError('Busca salva não encontrada.')

  return prisma.savedSearch.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: normalizeName(input.name) } : {}),
      ...(input.filters !== undefined ? { filters: normalizeFilters(input.filters) } : {}),
    },
  })
}

export async function deleteSavedSearch(saveId: string, id: string, userId: string) {
  await assertSaveAccess(saveId, userId)

  const existing = await prisma.savedSearch.findFirst({ where: { id, saveId } })
  if (!existing) throw new NotFoundError('Busca salva não encontrada.')

  await prisma.savedSearch.delete({ where: { id } })
}

function normalizeName(name: string) {
  const trimmed = name?.trim()
  if (!trimmed) throw new AppError('Nome da busca é obrigatório.', 400)
  if (trimmed.length > 80) throw new AppError('Nome da busca deve ter no máximo 80 caracteres.', 400)
  return trimmed
}

function normalizeFilters(filters: Record<string, unknown>) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    throw new AppError('Filtros inválidos.', 400)
  }
  return filters as Prisma.InputJsonValue
}
