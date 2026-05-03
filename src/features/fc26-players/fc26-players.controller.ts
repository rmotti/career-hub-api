import { FastifyRequest, FastifyReply } from 'fastify'
import { listFc26Players, getFc26PlayerById, getFc26Filters } from './fc26-players.service.js'
import { NotFoundError } from '../../shared/utils/errors.js'

interface ListQuerystring {
  positions?: string
  nations?: string
  clubs?: string
  leagues?: string
  minOvr?: number
  maxOvr?: number
  minAge?: number
  maxAge?: number
  minPotential?: number
  maxPotential?: number
  minPace?: number
  maxPace?: number
  minHeight?: number
  maxHeight?: number
  preferredFoot?: string
  traits?: string
  limit?: number
  offset?: number
}

interface DetailParams {
  sofifaId: string
}

function splitParam(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

export async function listFc26PlayersHandler(
  request: FastifyRequest<{ Querystring: ListQuerystring }>,
  reply: FastifyReply
) {
  const { positions, nations, clubs, leagues, traits, preferredFoot, ...rest } = request.query

  const result = await listFc26Players({
    ...rest,
    positions: splitParam(positions),
    nations: splitParam(nations),
    clubs: splitParam(clubs),
    leagues: splitParam(leagues),
    traits: splitParam(traits),
    preferredFoot,
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

export async function getFc26FiltersHandler(
  _request: FastifyRequest,
  reply: FastifyReply
) {
  const filters = await getFc26Filters()
  return reply.send(filters)
}
