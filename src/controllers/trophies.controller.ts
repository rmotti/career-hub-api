import { FastifyRequest, FastifyReply } from 'fastify'
import * as trophiesService from '../services/trophies.service'

export async function listTrophies(
  request: FastifyRequest<{ Params: { saveId: string } }>,
  reply: FastifyReply
) {
  const trophies = await trophiesService.listTrophies(request.params.saveId)
  return reply.send(trophies)
}

export async function createTrophy(
  request: FastifyRequest<{
    Params: { saveId: string }
    Body: { name: string; year: number }
  }>,
  reply: FastifyReply
) {
  const trophy = await trophiesService.createTrophy(request.params.saveId, request.body)
  return reply.status(201).send(trophy)
}

export async function deleteTrophy(
  request: FastifyRequest<{ Params: { saveId: string; id: string } }>,
  reply: FastifyReply
) {
  await trophiesService.deleteTrophy(request.params.saveId, request.params.id)
  return reply.status(204).send()
}
