import { FastifyReply, FastifyRequest } from 'fastify'
import { invalidateCache } from './admin.service.js'

interface InvalidateBody { pattern: string }

export async function invalidateCacheHandler(
  request: FastifyRequest<{ Body: InvalidateBody }>,
  reply: FastifyReply,
) {
  const result = await invalidateCache(request.body.pattern)
  return reply.send({ invalidated: true, ...result })
}
