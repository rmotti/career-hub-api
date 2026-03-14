import { FastifyRequest, FastifyReply } from 'fastify'
import * as teamStatsService from '../services/teamStats.service'

export async function listTeamStats(
  request: FastifyRequest<{
    Params: { saveId: string }
    Querystring: { season?: string }
  }>,
  reply: FastifyReply
) {
  const stats = await teamStatsService.listTeamStats(
    request.params.saveId,
    request.query.season
  )
  return reply.send(stats)
}

export async function updateTeamStats(
  request: FastifyRequest<{
    Params: { saveId: string; statsId: string }
    Body: {
      goalsPro?: number
      goalsAgainst?: number
      possession?: number
      wins?: number
      draws?: number
      losses?: number
    }
  }>,
  reply: FastifyReply
) {
  const stats = await teamStatsService.updateTeamStats(
    request.params.saveId,
    request.params.statsId,
    request.body
  )
  return reply.send(stats)
}
