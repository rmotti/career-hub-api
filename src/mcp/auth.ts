import type { FastifyRequest } from 'fastify'
import { auth } from '../shared/lib/auth.js'
import { cacheGet, cacheSet } from '../shared/utils/cache.js'
import { AppError } from '../shared/utils/errors.js'
import type { McpContext } from './context.js'

const SESSION_TTL = 300

export async function resolveMcpContext(req: FastifyRequest): Promise<McpContext> {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '').trim()
  if (!token) throw new AppError('Unauthorized', 401)

  const cacheKey = `mcp:session:${token}`
  const cached = await cacheGet<{ userId: string }>(cacheKey)
  if (cached) return { userId: cached.userId, sessionToken: token }

  const session = await auth.api.getSession({ headers: req.headers as HeadersInit })
  if (!session?.user) throw new AppError('Unauthorized', 401)

  await cacheSet(cacheKey, { userId: session.user.id }, SESSION_TTL)
  return { userId: session.user.id, sessionToken: token }
}
