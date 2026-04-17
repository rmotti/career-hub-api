import { FastifyRequest, FastifyReply } from 'fastify'
import * as competitionsService from './competitions.service.js'

export async function listCompetitions(_request: FastifyRequest, reply: FastifyReply) {
  const competitions = await competitionsService.listCompetitions()
  return reply.send(competitions)
}

export async function listEuropeanCompetitions(_request: FastifyRequest, reply: FastifyReply) {
  const competitions = await competitionsService.listEuropeanCompetitions()
  return reply.send(competitions)
}
