import { FastifyRequest, FastifyReply } from 'fastify'
import * as playersService from './players.service.js'
import { Position, PlayerStatus } from '@prisma/client'

export async function listPlayers(
  request: FastifyRequest<{
    Params: { saveId: string }
    Querystring: { active?: string; season?: string; loaned?: string }
  }>,
  reply: FastifyReply
) {
  const loaned = request.query.loaned === 'true'
  const activeOnly = !loaned && request.query.active === 'true'
  const players = await playersService.listPlayers(request.params.saveId, activeOnly, request.query.season, loaned)
  return reply.send(players)
}

export async function getPlayer(
  request: FastifyRequest<{ Params: { saveId: string; playerId: string } }>,
  reply: FastifyReply
) {
  const player = await playersService.getPlayerById(
    request.params.saveId,
    request.params.playerId
  )
  return reply.send(player)
}

export async function createPlayer(
  request: FastifyRequest<{
    Params: { saveId: string }
    Body: {
      name: string
      position: Position
      age: number
      status: PlayerStatus
      ovr: number
      potential?: number
      shirtNumber?: number
      nation?: string
      alternativePosition?: { positions: Position[] }
      salary?: number
      marketValue?: number
    }
  }>,
  reply: FastifyReply
) {
  const player = await playersService.createPlayer(request.params.saveId, request.body)
  return reply.status(201).send(player)
}

export async function updatePlayer(
  request: FastifyRequest<{
    Params: { saveId: string; playerId: string }
    Body: {
      name?: string
      position?: Position
      age?: number
      status?: PlayerStatus
      ovr?: number
      potential?: number
      shirtNumber?: number
      nation?: string
      alternativePosition?: { positions: Position[] }
      salary?: number
      marketValue?: number
      matches?: number
    }
  }>,
  reply: FastifyReply
) {
  const player = await playersService.updatePlayer(
    request.params.saveId,
    request.params.playerId,
    request.body
  )
  return reply.send(player)
}

export async function updatePlayerStats(
  request: FastifyRequest<{
    Params: { saveId: string; playerId: string }
    Body: { goals?: number; assists?: number; matches?: number; yellowCards?: number; redCards?: number; cleanSheets?: number }
  }>,
  reply: FastifyReply
) {
  const stats = await playersService.updatePlayerStats(
    request.params.saveId,
    request.params.playerId,
    request.body
  )
  return reply.send(stats)
}

export async function importFc26Squad(
  request: FastifyRequest<{ Params: { saveId: string } }>,
  reply: FastifyReply
) {
  const result = await playersService.importFc26Squad(request.params.saveId, request.user!.id)
  return reply.status(201).send(result)
}

export async function releasePlayer(
  request: FastifyRequest<{ Params: { saveId: string; playerId: string } }>,
  reply: FastifyReply
) {
  const player = await playersService.releasePlayer(
    request.params.saveId,
    request.params.playerId,
    request.user!.id
  )
  return reply.send(player)
}

export async function recallPlayer(
  request: FastifyRequest<{ Params: { saveId: string; playerId: string } }>,
  reply: FastifyReply
) {
  const player = await playersService.recallLoanedPlayer(
    request.params.saveId,
    request.params.playerId,
    request.user!.id
  )
  return reply.send(player)
}

export async function getLoanSpellStats(
  request: FastifyRequest<{ Params: { saveId: string; playerId: string } }>,
  reply: FastifyReply
) {
  const stats = await playersService.getLoanSpellStats(
    request.params.saveId,
    request.params.playerId
  )
  return reply.send(stats)
}

export async function updateLoanSpellStats(
  request: FastifyRequest<{
    Params: { saveId: string; playerId: string }
    Body: { goals?: number; assists?: number; matches?: number }
  }>,
  reply: FastifyReply
) {
  const stats = await playersService.upsertLoanSpellStats(
    request.params.saveId,
    request.params.playerId,
    request.body
  )
  return reply.send(stats)
}
