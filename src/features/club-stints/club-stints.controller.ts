import { FastifyRequest, FastifyReply } from 'fastify'
import * as clubStintsService from './club-stints.service.js'

export async function listClubStints(
  request: FastifyRequest<{ Params: { saveId: string } }>,
  reply: FastifyReply
) {
  const stints = await clubStintsService.listClubStints(request.params.saveId)
  return reply.send(stints)
}

export async function getCurrentClubStint(
  request: FastifyRequest<{ Params: { saveId: string } }>,
  reply: FastifyReply
) {
  const stint = await clubStintsService.getCurrentClubStint(request.params.saveId)
  return reply.send(stint)
}

export async function createClubStint(
  request: FastifyRequest<{ Params: { saveId: string }; Body: { club: string; europeanCompetitionId?: string | null } }>,
  reply: FastifyReply
) {
  const stint = await clubStintsService.createClubStint(
    request.params.saveId,
    request.body
  )
  return reply.status(201).send(stint)
}

export async function updateClubStint(
  request: FastifyRequest<{
    Params: { saveId: string; stintId: string }
    Body: { club?: string; startYear?: string; endYear?: string }
  }>,
  reply: FastifyReply
) {
  const stint = await clubStintsService.updateClubStint(
    request.params.saveId,
    request.params.stintId,
    request.body
  )
  return reply.send(stint)
}
