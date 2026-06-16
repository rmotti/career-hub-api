import type { FastifyRequest } from 'fastify'
import { randomBytes } from 'node:crypto'
import { auth } from '../shared/lib/auth.js'
import { cacheGet, cacheSet } from '../shared/utils/cache.js'
import { AppError } from '../shared/utils/errors.js'
import type { McpContext } from './context.js'

const SESSION_TTL = 300
const SCOPED_TTL = 600 // 10 min — covers one chat round; much shorter than the real session

/**
 * Issues an ephemeral, MCP-ONLY-scoped token bound to a user.
 * Used in chat for the OpenAI callback: this way the full session token (which grants
 * full account access) never leaves our infrastructure. This token does not authenticate
 * against the main API — it's only recognized by `resolveMcpContext`.
 */
export async function mintMcpToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await cacheSet(`mcp:scoped:${token}`, { userId }, SCOPED_TTL)
  return token
}

export async function resolveMcpContext(req: FastifyRequest): Promise<McpContext> {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '').trim()
  if (!token) throw new AppError('Unauthorized', 401)

  // 1) Ephemeral MCP-scoped token (issued for the OpenAI callback in chat)
  const scoped = await cacheGet<{ userId: string }>(`mcp:scoped:${token}`)
  if (scoped) return { userId: scoped.userId, sessionToken: token }

  // 2) Full session token (direct MCP clients)
  const cacheKey = `mcp:session:${token}`
  const cached = await cacheGet<{ userId: string }>(cacheKey)
  if (cached) return { userId: cached.userId, sessionToken: token }

  const session = await auth.api.getSession({ headers: req.headers as HeadersInit })
  if (!session?.user) throw new AppError('Unauthorized', 401)

  await cacheSet(cacheKey, { userId: session.user.id }, SESSION_TTL)
  return { userId: session.user.id, sessionToken: token }
}
