import { FastifyRequest, FastifyReply } from 'fastify'
import { getAllClubs } from '../services/clubs.service'

export async function listClubs(_request: FastifyRequest, reply: FastifyReply) {
  const clubs = getAllClubs()
  return reply.send(clubs)
}
