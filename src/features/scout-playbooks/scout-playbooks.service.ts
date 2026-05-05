import { prisma } from '../../shared/lib/prisma.js'
import { AppError, NotFoundError } from '../../shared/utils/errors.js'
import { listFc26Players, type Fc26PlayerFilters, type Fc26PlayerWithFitScore } from '../fc26-players/fc26-players.service.js'
import { calculateScoutScore, normalizePreferences, normalizeWeights, resolveInlinePlaybook } from './scout-score.js'
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

  const result = await listFc26Players({
    ...(input.filters ?? {}),
    saveId: input.saveId,
    objective,
  })

  const players = result.players.map((player) => {
    const playerWithFit = normalizePlayerFitFields(player as Partial<Fc26PlayerWithFitScore>)
    return {
      ...player,
      ...calculateScoutScore(playerWithFit, playbook),
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

async function assertSaveAccess(saveId: string, userId: string) {
  const save = await prisma.save.findFirst({
    where: { id: saveId, userId },
    select: { id: true },
  })

  if (!save) throw new NotFoundError('Save não encontrado.')
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
    preferences: normalizePreferences(input.preferences),
  }
}

function buildPartialPlaybookData(input: ScoutPlaybookUpdateInput) {
  const data: {
    name?: string
    weights?: ReturnType<typeof normalizeWeights>
    preferences?: ReturnType<typeof normalizePreferences>
  } = {}

  if (input.name !== undefined) data.name = normalizeName(input.name)

  if (input.weights !== undefined) {
    data.weights = normalizeWeights(input.weights)
    assertPositiveWeights(data.weights)
  }

  if (input.preferences !== undefined) {
    data.preferences = normalizePreferences(input.preferences)
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

function normalizePlayerFitFields(player: Partial<Fc26PlayerWithFitScore>): Fc26PlayerWithFitScore {
  return {
    ...player,
    fitScore: typeof player.fitScore === 'number' ? player.fitScore : null,
    fitConfidence: player.fitConfidence ?? null,
    fitProfileSize: typeof player.fitProfileSize === 'number' ? player.fitProfileSize : null,
  } as Fc26PlayerWithFitScore
}
