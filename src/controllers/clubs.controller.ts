import { FastifyRequest, FastifyReply } from 'fastify'
import { getAllClubs, CLUBS_BY_LEAGUE } from '../services/clubs.service'

export async function listClubs(_request: FastifyRequest, reply: FastifyReply) {
  const clubs = getAllClubs()
  return reply.send(clubs)
}

export async function listClubsByLeague(_request: FastifyRequest, reply: FastifyReply) {
  return reply.send(CLUBS_BY_LEAGUE)
}
