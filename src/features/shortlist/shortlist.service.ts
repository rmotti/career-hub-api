import { Prisma, ShortlistPriority } from '@prisma/client'
import { prisma } from '../../shared/lib/prisma.js'
import { AppError, NotFoundError } from '../../shared/utils/errors.js'
import { assertSaveAccess } from '../../shared/utils/save-access.js'
import { computeFitScoreMap } from '../fc26-players/fc26-players.service.js'
import type { FitScoreResult } from '../../shared/lib/fit-score-client.js'

const DEFAULT_OBJECTIVE = 'balanced'

const SHORTLIST_PLAYER_SELECT = {
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
} satisfies Prisma.Fc26PlayerSelect

type ShortlistItemWithPlayer = Prisma.ShortlistItemGetPayload<{
  include: { fc26Player: { select: typeof SHORTLIST_PLAYER_SELECT } }
}>

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
    include: { fc26Player: { select: SHORTLIST_PLAYER_SELECT } },
  })

  return enrichShortlistWithFitScore(saveId, items)
}

/**
 * Attaches the fit-score fields to each shortlisted player, computed against the save's active
 * club and the objective of its default playbook (so the score matches what scouting shows and
 * reuses the same Redis cache). Fails open: without an active club, or when the fit-score service
 * is unavailable, the fields are present but null — the shortlist still loads.
 */
async function enrichShortlistWithFitScore(saveId: string, items: ShortlistItemWithPlayer[]) {
  if (!items.length) return items

  const clubStint = await prisma.clubStint.findFirst({
    where: { saveId, isCurrent: true },
    select: { club: true },
  })

  if (!clubStint) return items.map((item) => attachFit(item))

  const objective = await resolveSaveObjective(saveId)
  const scoreMap = await computeFitScoreMap(
    items.map((item) => item.fc26Player),
    clubStint.club,
    objective,
  )

  return items.map((item) => attachFit(item, scoreMap.get(item.fc26Player.sofifaId)))
}

function attachFit(item: ShortlistItemWithPlayer, result?: FitScoreResult) {
  return {
    ...item,
    fc26Player: {
      ...item.fc26Player,
      fitScore: result?.fit_score ?? null,
      fitConfidence: result?.confidence ?? null,
      fitProfileSize: result?.profile_size ?? null,
    },
  }
}

async function resolveSaveObjective(saveId: string): Promise<string> {
  const playbook = await prisma.scoutPlaybook.findFirst({
    where: { saveId, isDefault: true },
    orderBy: { updatedAt: 'desc' },
    select: { preferences: true },
  })

  const objective = (playbook?.preferences as { objective?: string } | null)?.objective
  return objective ?? DEFAULT_OBJECTIVE
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

function normalizeNotes(notes?: string | null) {
  if (notes === undefined) return undefined
  if (notes === null) return null
  const trimmed = notes.trim()
  if (!trimmed) return null
  if (trimmed.length > 500) throw new AppError('Notas devem ter no máximo 500 caracteres.', 400)
  return trimmed
}
