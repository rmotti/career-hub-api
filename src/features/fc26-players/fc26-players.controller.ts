import { FastifyRequest, FastifyReply } from 'fastify'
import { listFc26Players, getFc26PlayerById } from './fc26-players.service.js'
import { NotFoundError } from '../../shared/utils/errors.js'

interface ListQuerystring {
  positions?: string
  minOvr?: number
  maxOvr?: number
  minAge?: number
  maxAge?: number
  minPotential?: number
  nation?: string
  limit?: number
  offset?: number
}

interface DetailParams {
  sofifaId: string
}

export async function listFc26PlayersHandler(
  request: FastifyRequest<{ Querystring: ListQuerystring }>,
  reply: FastifyReply
) {
  const { positions, ...rest } = request.query

  const result = await listFc26Players({
    ...rest,
    positions: positions ? positions.split(',').map((p) => p.trim()) : undefined,
  })

  return reply.send(result)
}

export async function getFc26PlayerHandler(
  request: FastifyRequest<{ Params: DetailParams }>,
  reply: FastifyReply
) {
  const sofifaId = Number(request.params.sofifaId)
  const player = await getFc26PlayerById(sofifaId)

  if (!player) throw new NotFoundError('Jogador não encontrado')

  return reply.send(player)
}
