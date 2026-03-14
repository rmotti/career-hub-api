import { FastifyRequest, FastifyReply } from 'fastify'
import * as playersService from '../services/players.service'
import { Position, PlayerStatus } from '@prisma/client'

export async function listPlayers(
  request: FastifyRequest<{
    Params: { saveId: string }
    Querystring: { active?: string }
  }>,
  reply: FastifyReply
) {
  const activeOnly = request.query.active === 'true'
  const players = await playersService.listPlayers(request.params.saveId, activeOnly)
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
      salary?: string
      marketValue?: string
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
      salary?: string
      marketValue?: string
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
    Body: { goals?: number; assists?: number; matches?: number; yellowCards?: number; redCards?: number }
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

export async function releasePlayer(
  request: FastifyRequest<{ Params: { saveId: string; playerId: string } }>,
  reply: FastifyReply
) {
  const player = await playersService.releasePlayer(
    request.params.saveId,
    request.params.playerId
  )
  return reply.send(player)
}
