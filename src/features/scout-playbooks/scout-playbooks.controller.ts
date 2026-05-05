import { FastifyReply, FastifyRequest } from 'fastify'
import { type Fc26PlayerFilters } from '../fc26-players/fc26-players.service.js'
import {
  createScoutPlaybook,
  deleteScoutPlaybook,
  evaluateScoutPlayers,
  getScoutPlaybook,
  listScoutPlaybooks,
  updateScoutPlaybook,
} from './scout-playbooks.service.js'
import { ScoutPlaybookCreateInput, ScoutPlaybookInput, ScoutPlaybookUpdateInput } from './scout-playbooks.types.js'

interface ListPlaybooksQuerystring {
  saveId: string
}

interface PlaybookParams {
  playbookId: string
}

interface EvaluateBody {
  saveId: string
  filters?: Omit<Fc26PlayerFilters, 'saveId'>
  playbookId?: string
  playbook?: ScoutPlaybookInput
}

export async function listPlaybooksHandler(
  request: FastifyRequest<{ Querystring: ListPlaybooksQuerystring }>,
  reply: FastifyReply
) {
  const result = await listScoutPlaybooks(request.query.saveId, request.user!.id)
  return reply.send(result)
}

export async function getPlaybookHandler(
  request: FastifyRequest<{ Params: PlaybookParams }>,
  reply: FastifyReply
) {
  const result = await getScoutPlaybook(request.params.playbookId, request.user!.id)
  return reply.send(result)
}

export async function createPlaybookHandler(
  request: FastifyRequest<{ Body: ScoutPlaybookCreateInput }>,
  reply: FastifyReply
) {
  const result = await createScoutPlaybook(request.body, request.user!.id)
  return reply.status(201).send(result)
}

export async function updatePlaybookHandler(
  request: FastifyRequest<{ Params: PlaybookParams; Body: ScoutPlaybookUpdateInput }>,
  reply: FastifyReply
) {
  const result = await updateScoutPlaybook(request.params.playbookId, request.body, request.user!.id)
  return reply.send(result)
}

export async function deletePlaybookHandler(
  request: FastifyRequest<{ Params: PlaybookParams }>,
  reply: FastifyReply
) {
  await deleteScoutPlaybook(request.params.playbookId, request.user!.id)
  return reply.status(204).send()
}

export async function evaluateScoutHandler(
  request: FastifyRequest<{ Body: EvaluateBody }>,
  reply: FastifyReply
) {
  const result = await evaluateScoutPlayers(request.body, request.user!.id)
  return reply.send(result)
}
