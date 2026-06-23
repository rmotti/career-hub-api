import { Prisma } from '@prisma/client'
import { prisma } from '../../shared/lib/prisma.js'
import { AppError, NotFoundError } from '../../shared/utils/errors.js'
import { assertSaveAccess } from '../../shared/utils/save-access.js'
import { computeFitScoreMap, listFc26Players, type Fc26PlayerFilters, type Fc26PlayerWithFitScore } from '../fc26-players/fc26-players.service.js'
import { calculateScoutScore, normalizePreferences, normalizeWeights, resolveInlinePlaybook, type ScoutScoreContext } from './scout-score.js'
import {
  DEFAULT_SCOUT_PLAYBOOK,
  ResolvedScoutPlaybook,
  ScoutPlaybookCreateInput,
  ScoutPlaybookInput,
  ScoutPlaybookUpdateInput,
} from './scout-playbooks.types.js'

type ScoutPlaybookRecord = Awaited<ReturnType<typeof prisma.scoutPlaybook.findFirst>>

export interface ScoutEvaluateInput {
  saveId: string
  filters?: Omit<Fc26PlayerFilters, 'saveId'>
  playbookId?: string
  playbook?: ScoutPlaybookInput
}

export async function listScoutPlaybooks(saveId: string, userId: string) {
  await assertSaveAccess(saveId, userId)

  const playbooks = await prisma.scoutPlaybook.findMany({
    where: { saveId },
    orderBy: [
      { isDefault: 'desc' },
      { updatedAt: 'desc' },
    ],
  })

  return {
    defaultPlaybook: DEFAULT_SCOUT_PLAYBOOK,
    playbooks: playbooks.map(mapPlaybook),
  }
}

export async function getScoutPlaybook(playbookId: string, userId: string) {
  const playbook = await findPlaybookForUser(playbookId, userId)
  if (!playbook) throw new NotFoundError('Playbook não encontrado.')
  return mapPlaybook(playbook)
}

export async function createScoutPlaybook(input: ScoutPlaybookCreateInput, userId: string) {
  await assertSaveAccess(input.saveId, userId)

  const data = buildPlaybookData(input)

  if (input.isDefault) {
    const created = await prisma.$transaction(async (tx) => {
      await tx.scoutPlaybook.updateMany({
        where: { saveId: input.saveId },
        data: { isDefault: false },
      })

      return tx.scoutPlaybook.create({
        data: {
          saveId: input.saveId,
          ...data,
          isDefault: true,
        },
      })
    })

    return mapPlaybook(created)
  }

  const created = await prisma.scoutPlaybook.create({
    data: {
      saveId: input.saveId,
      ...data,
      isDefault: false,
    },
  })

  return mapPlaybook(created)
}

export async function updateScoutPlaybook(playbookId: string, input: ScoutPlaybookUpdateInput, userId: string) {
  const existing = await findPlaybookForUser(playbookId, userId)
  if (!existing) throw new NotFoundError('Playbook não encontrado.')

  const data = buildPartialPlaybookData(input)

  if (input.isDefault === true) {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.scoutPlaybook.updateMany({
        where: { saveId: existing.saveId, id: { not: playbookId } },
        data: { isDefault: false },
      })

      return tx.scoutPlaybook.update({
        where: { id: playbookId },
        data: { ...data, isDefault: true },
      })
    })

    return mapPlaybook(updated)
  }

  const updated = await prisma.scoutPlaybook.update({
    where: { id: playbookId },
    data: input.isDefault === false ? { ...data, isDefault: false } : data,
  })

  return mapPlaybook(updated)
}

export async function deleteScoutPlaybook(playbookId: string, userId: string) {
  const existing = await findPlaybookForUser(playbookId, userId)
  if (!existing) throw new NotFoundError('Playbook não encontrado.')

  await prisma.scoutPlaybook.delete({ where: { id: playbookId } })
}

export async function evaluateScoutPlayers(input: ScoutEvaluateInput, userId: string) {
  await assertSaveAccess(input.saveId, userId)

  const playbook = await resolveEvaluationPlaybook(input, userId)
  const objective = playbook.preferences.objective ?? input.filters?.objective ?? DEFAULT_SCOUT_PLAYBOOK.preferences.objective

  // Transfer budget drives the marketValue gradient when no explicit cap is set (B-003 #1).
  const save = await prisma.save.findUnique({ where: { id: input.saveId }, select: { budget: true } })
  const saveBudget = save?.budget ?? null

  // Explicit caps are a HARD filter (over-cap players excluded from the list) AND the gradient
  // reference: marketValue falls back to the save budget; wage has no fallback (opt-in).
  const marketCap = minDefined(input.filters?.maxMarketValue, playbook.preferences.maxMarketValue)
  const wageCap = playbook.preferences.maxWage
  const context: ScoutScoreContext = {
    marketValueRef: marketCap ?? saveBudget,
    wageRef: wageCap ?? null,
  }

  const result = await listFc26Players({
    ...(input.filters ?? {}),
    saveId: input.saveId,
    objective,
    ...(marketCap !== undefined ? { maxMarketValue: marketCap } : {}),
    ...(wageCap !== undefined ? { maxWage: wageCap } : {}),
  })

  const players = result.players.map((player) => {
    const playerWithFit = normalizePlayerFitFields(player as Partial<Fc26PlayerWithFitScore>)
    return {
      ...player,
      ...calculateScoutScore(playerWithFit, playbook, context),
    }
  }).sort((a, b) => {
    if (a.scoutScore === null) return 1
    if (b.scoutScore === null) return -1
    return b.scoutScore - a.scoutScore
  })

  return {
    ...result,
    playbook,
    players,
  }
}

/**
 * Scores a specific set of dataset players (by sofifaId) with the save's playbook + budget +
 * historical fit — the same engine `evaluateScoutPlayers` uses, but for an explicit id list
 * instead of a filtered search. Powers the chat `compare_players` tool. Order follows the
 * `sofifaIds` argument; ids with no dataset row are dropped.
 */
export async function scorePlayersBySofifaId(
  input: { saveId: string; sofifaIds: number[]; playbookId?: string; objective?: string },
  userId: string,
) {
  await assertSaveAccess(input.saveId, userId)

  const playbook = await resolveEvaluationPlaybook({ saveId: input.saveId, playbookId: input.playbookId }, userId)
  const objective = playbook.preferences.objective ?? input.objective ?? 'balanced'

  const save = await prisma.save.findUnique({ where: { id: input.saveId }, select: { budget: true } })
  const context: ScoutScoreContext = {
    marketValueRef: playbook.preferences.maxMarketValue ?? save?.budget ?? null,
    wageRef: playbook.preferences.maxWage ?? null,
  }

  const rows = await prisma.fc26Player.findMany({ where: { sofifaId: { in: input.sofifaIds } } })

  const clubStint = await prisma.clubStint.findFirst({
    where: { saveId: input.saveId, isCurrent: true },
    select: { club: true },
  })
  let scoreMap: Awaited<ReturnType<typeof computeFitScoreMap>> = new Map()
  if (clubStint) scoreMap = await computeFitScoreMap(rows, clubStint.club, objective)

  // Preserve the caller's id order so the comparison reads in the order the user asked.
  const byId = new Map(rows.map((p) => [p.sofifaId, p]))
  const players = input.sofifaIds
    .map((id) => byId.get(id))
    .filter((p): p is (typeof rows)[number] => p !== undefined)
    .map((p) => {
      const fit = scoreMap.get(p.sofifaId)
      const withFit = normalizePlayerFitFields({
        ...p,
        fitScore: fit?.fit_score ?? null,
        fitConfidence: fit?.confidence ?? null,
        fitProfileSize: fit?.profile_size ?? null,
      })
      return { ...withFit, ...calculateScoutScore(withFit, playbook, context) }
    })

  return { playbook, objective, players }
}

async function resolveEvaluationPlaybook(input: ScoutEvaluateInput, userId: string): Promise<ResolvedScoutPlaybook> {
  if (input.playbookId) {
    return getScoutPlaybook(input.playbookId, userId)
  }

  if (input.playbook) {
    return resolveInlinePlaybook(input.playbook)
  }

  const defaultPlaybook = await prisma.scoutPlaybook.findFirst({
    where: { saveId: input.saveId, isDefault: true },
    orderBy: { updatedAt: 'desc' },
  })

  return defaultPlaybook ? mapPlaybook(defaultPlaybook) : DEFAULT_SCOUT_PLAYBOOK
}

async function findPlaybookForUser(playbookId: string, userId: string) {
  return prisma.scoutPlaybook.findFirst({
    where: {
      id: playbookId,
      save: { userId },
    },
  })
}

function buildPlaybookData(input: ScoutPlaybookInput) {
  const name = normalizeName(input.name)
  const weights = normalizeWeights(input.weights)
  assertPositiveWeights(weights)

  return {
    name,
    weights,
    preferences: normalizePreferences(input.preferences) as unknown as Prisma.InputJsonValue,
  }
}

function buildPartialPlaybookData(input: ScoutPlaybookUpdateInput) {
  const data: {
    name?: string
    weights?: ReturnType<typeof normalizeWeights>
    preferences?: Prisma.InputJsonValue
  } = {}

  if (input.name !== undefined) data.name = normalizeName(input.name)

  if (input.weights !== undefined) {
    data.weights = normalizeWeights(input.weights)
    assertPositiveWeights(data.weights)
  }

  if (input.preferences !== undefined) {
    data.preferences = normalizePreferences(input.preferences) as unknown as Prisma.InputJsonValue
  }

  return data
}

function normalizeName(name?: string) {
  const normalized = name?.trim()
  if (!normalized) throw new AppError('Nome do playbook é obrigatório.', 400)
  if (normalized.length > 80) throw new AppError('Nome do playbook deve ter no máximo 80 caracteres.', 400)
  return normalized
}

function assertPositiveWeights(weights: ReturnType<typeof normalizeWeights>) {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0)
  if (total <= 0) {
    throw new AppError('O playbook precisa ter pelo menos um peso maior que zero.', 400)
  }
}

function mapPlaybook(playbook: NonNullable<ScoutPlaybookRecord>) {
  return {
    id: playbook.id,
    saveId: playbook.saveId,
    name: playbook.name,
    weights: normalizeWeights(playbook.weights as unknown as ScoutPlaybookInput['weights']),
    preferences: normalizePreferences(playbook.preferences as unknown as ScoutPlaybookInput['preferences']),
    isDefault: playbook.isDefault,
    createdAt: playbook.createdAt,
    updatedAt: playbook.updatedAt,
  }
}

function minDefined(...values: Array<number | undefined>): number | undefined {
  const defined = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  return defined.length ? Math.min(...defined) : undefined
}

function normalizePlayerFitFields(player: Partial<Fc26PlayerWithFitScore>): Fc26PlayerWithFitScore {
  return {
    ...player,
    fitScore: typeof player.fitScore === 'number' ? player.fitScore : null,
    fitConfidence: player.fitConfidence ?? null,
    fitProfileSize: typeof player.fitProfileSize === 'number' ? player.fitProfileSize : null,
  } as Fc26PlayerWithFitScore
}
