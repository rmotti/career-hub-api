import { FastifyRequest, FastifyReply } from 'fastify'
import * as teamStatsService from './team-stats.service.js'
import { CupResult } from '@prisma/client'

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

export async function addTeamStat(
  request: FastifyRequest<{
    Params: { saveId: string }
    Body: { competitionId: string; season?: string; clubStintId?: string }
  }>,
  reply: FastifyReply
) {
  const stat = await teamStatsService.addTeamStat(request.params.saveId, request.body)
  return reply.status(201).send(stat)
}

export async function removeTeamStat(
  request: FastifyRequest<{ Params: { saveId: string; statsId: string } }>,
  reply: FastifyReply
) {
  await teamStatsService.removeTeamStat(request.params.saveId, request.params.statsId)
  return reply.status(204).send()
}

export async function updateTeamStats(
  request: FastifyRequest<{
    Params: { saveId: string; statsId: string }
    Body: {
      goalsPro?: number
      goalsAgainst?: number
      wins?: number
      draws?: number
      losses?: number
      leaguePosition?: number
      cupResult?: CupResult
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
