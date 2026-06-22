import { FastifyReply, FastifyRequest } from 'fastify'
import { evaluateSigningFit, getClubArchetype, identifyGaps, searchTransferTargets } from './scouting.service.js'

interface SaveParams { saveId: string }
interface EvaluateParams { saveId: string; sofifaId: string }

interface GapsQuery { formation?: string }
interface TargetsQuery {
  position: string
  maxAge?: number
  minOverall?: number
  maxValue?: number
  saveId?: string
}

export async function identifyGapsHandler(
  request: FastifyRequest<{ Params: SaveParams; Querystring: GapsQuery }>,
  reply: FastifyReply,
) {
  const gaps = await identifyGaps(request.user!.id, request.params.saveId, {
    formation: request.query.formation,
  })
  return reply.send({ gaps })
}

export async function searchTransferTargetsHandler(
  request: FastifyRequest<{ Querystring: TargetsQuery }>,
  reply: FastifyReply,
) {
  const result = await searchTransferTargets(request.user!.id, request.query)
  return reply.send(result)
}

export async function evaluateSigningFitHandler(
  request: FastifyRequest<{ Params: EvaluateParams }>,
  reply: FastifyReply,
) {
  const sofifaId = Number(request.params.sofifaId)
  const result = await evaluateSigningFit(request.user!.id, request.params.saveId, sofifaId)
  return reply.send(result)
}

interface ArchetypeQuery { position: string; objective?: string }

export async function getClubArchetypeHandler(
  request: FastifyRequest<{ Params: SaveParams; Querystring: ArchetypeQuery }>,
  reply: FastifyReply,
) {
  const result = await getClubArchetype(
    request.user!.id,
    request.params.saveId,
    request.query.position,
    request.query.objective ?? 'balanced',
  )
  return reply.send(result)
}
