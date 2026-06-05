import { FastifyRequest, FastifyReply } from 'fastify'
import { auth } from '../lib/auth.js'
import { AppError } from './errors.js'
import { cacheGet, cacheInvalidate } from './cache.js'
import { cacheSession } from './session-cache.js'
import {
  parseCookies,
  safeEqual,
  SESSION_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
} from './cookies.js'

type UserRole = 'admin' | 'user'
type UserPlan = 'FREE' | 'PRO' | 'PREMIUM'

const PLAN_HIERARCHY: Record<UserPlan, number> = {
  FREE: 0,
  PRO: 1,
  PREMIUM: 2,
}

const SESSION_TTL = 5 * 60 // 5 minutos

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Extrai o token de sessão. Lê PRIMEIRO o cookie httpOnly `session_token` (novo fluxo,
 * resistente a XSS) e cai para o header `Authorization: Bearer` (backward-compat, transição
 * sem downtime). O valor é o mesmo nos dois — o `token` cru devolvido no login —, então a
 * chave de cache e a validação no Better Auth convergem.
 */
export function extractSessionToken(request: FastifyRequest): string {
  const cookieToken = parseCookies(request)[SESSION_COOKIE]
  if (cookieToken) return cookieToken
  return (request.headers.authorization ?? '').replace('Bearer ', '').trim()
}

async function getSession(request: FastifyRequest) {
  const token = extractSessionToken(request)
  const url = new URL(request.url, `${request.protocol}://${request.hostname}`)
  const query = Object.fromEntries(url.searchParams)

  if (token) {
    const cacheKey = `session:${token}`
    const cached = await cacheGet<object>(cacheKey)
    if (cached) return cached as Awaited<ReturnType<typeof auth.api.getSession>>

    // Injeta o token como Bearer para que o plugin `bearer` do Better Auth valide tanto
    // o que veio do cookie quanto o que veio do header pelo mesmo caminho.
    const session = await auth.api.getSession({
      headers: { authorization: `Bearer ${token}` },
      query,
    })

    if (session?.user) await cacheSession(token, session.user.id, session, SESSION_TTL)
    return session
  }

  // Sem token explícito → deixa o Better Auth tentar o cookie nativo dele (backward-compat).
  return auth.api.getSession({ headers: request.headers as HeadersInit, query })
}

export async function invalidateSessionCache(token: string) {
  if (token) await cacheInvalidate(`session:${token}`)
}

/**
 * Proteção CSRF (double-submit) para o fluxo por cookie. Como o cookie de sessão é
 * `SameSite=None`, o browser o envia em requisições cross-site → exigimos prova de que
 * a requisição partiu do nosso frontend: o header `X-CSRF-Token` precisa bater com o
 * cookie `csrf_token`.
 *
 * Só vale para escritas (POST/PUT/PATCH/DELETE) AUTENTICADAS POR COOKIE. Requisições com
 * Bearer não sofrem CSRF (o browser não anexa o header `Authorization` automaticamente, e
 * clientes não-browser — MCP, mobile — não estão sujeitos a CSRF), então passam direto.
 * Isso preserva o zero-downtime: clientes Bearer legados seguem funcionando sem header CSRF.
 */
export function csrfProtection() {
  return async function (request: FastifyRequest, _reply: FastifyReply) {
    if (SAFE_METHODS.has(request.method.toUpperCase())) return

    const cookies = parseCookies(request)
    if (!cookies[SESSION_COOKIE]) return // não é fluxo por cookie → CSRF não se aplica

    const cookieToken = cookies[CSRF_COOKIE]
    const rawHeader = request.headers[CSRF_HEADER]
    const headerToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader

    if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
      throw new AppError('Token CSRF ausente ou inválido.', 403, 'CSRF_TOKEN_INVALID')
    }
  }
}

export function requireAuth() {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const session = await getSession(request)

    if (!session?.user) {
      throw new AppError('Não autenticado.', 401)
    }

    request.user = session.user
    request.session = session.session
  }
}

export function requireRole(role: UserRole) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const session = await getSession(request)

    if (!session?.user) {
      throw new AppError('Não autenticado.', 401)
    }

    const userRole = (session.user as { role?: string }).role as UserRole | undefined

    if (userRole !== role) {
      throw new AppError('Acesso negado.', 403)
    }

    request.user = session.user
    request.session = session.session
  }
}

export function requirePlan(minimumPlan: UserPlan) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const session = await getSession(request)

    if (!session?.user) {
      throw new AppError('Não autenticado.', 401)
    }

    const userPlan = ((session.user as { plan?: string }).plan ?? 'FREE') as UserPlan
    const userRole = (session.user as { role?: string }).role as UserRole | undefined

    // admin sempre passa
    if (userRole === 'admin') {
      request.user = session.user
      request.session = session.session
      return
    }

    if (PLAN_HIERARCHY[userPlan] < PLAN_HIERARCHY[minimumPlan]) {
      throw new AppError(`Esta funcionalidade requer o plano ${minimumPlan} ou superior.`, 403)
    }

    request.user = session.user
    request.session = session.session
  }
}
