import type { FastifyRequest } from 'fastify'
import { randomBytes } from 'node:crypto'
import { auth } from '../shared/lib/auth.js'
import { cacheGet, cacheSet } from '../shared/utils/cache.js'
import { AppError } from '../shared/utils/errors.js'
import type { McpContext } from './context.js'

const SESSION_TTL = 300
const SCOPED_TTL = 600 // 10 min — cobre uma rodada de chat; bem menor que a sessão real

/**
 * Emite um token efêmero com escopo APENAS de MCP, vinculado a um usuário.
 * Usado no chat para o callback da OpenAI: assim o token de sessão completo (que dá
 * acesso total à conta) nunca sai da nossa infraestrutura. Este token não autentica
 * na API principal — só é reconhecido por `resolveMcpContext`.
 */
export async function mintMcpToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await cacheSet(`mcp:scoped:${token}`, { userId }, SCOPED_TTL)
  return token
}

export async function resolveMcpContext(req: FastifyRequest): Promise<McpContext> {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '').trim()
  if (!token) throw new AppError('Unauthorized', 401)

  // 1) Token efêmero com escopo MCP (emitido para o callback da OpenAI no chat)
  const scoped = await cacheGet<{ userId: string }>(`mcp:scoped:${token}`)
  if (scoped) return { userId: scoped.userId, sessionToken: token }

  // 2) Token de sessão completo (clientes MCP diretos)
  const cacheKey = `mcp:session:${token}`
  const cached = await cacheGet<{ userId: string }>(cacheKey)
  if (cached) return { userId: cached.userId, sessionToken: token }

  const session = await auth.api.getSession({ headers: req.headers as HeadersInit })
  if (!session?.user) throw new AppError('Unauthorized', 401)

  await cacheSet(cacheKey, { userId: session.user.id }, SESSION_TTL)
  return { userId: session.user.id, sessionToken: token }
}
