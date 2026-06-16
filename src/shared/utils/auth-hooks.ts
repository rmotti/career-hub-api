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
 * Extracts the session token. Reads the httpOnly `session_token` cookie FIRST (new flow,
 * XSS-resistant) and falls back to the `Authorization: Bearer` header (backward-compat,
 * zero-downtime transition). The value is the same in both — the raw `token` returned at login —
 * so the cache key and the Better Auth validation converge.
 */
export function extractSessionToken(request: FastifyRequest): string {
  const cookieToken = parseCookies(request)[SESSION_COOKIE]
  if (cookieToken) return cookieToken
  return (request.headers.authorization ?? '').replace('Bearer ', '').trim()
}

export async function getSession(request: FastifyRequest) {
  const token = extractSessionToken(request)
  const url = new URL(request.url, `${request.protocol}://${request.hostname}`)
  const query = Object.fromEntries(url.searchParams)

  if (token) {
    const cacheKey = `session:${token}`
    const cached = await cacheGet<object>(cacheKey)
    if (cached) return cached as Awaited<ReturnType<typeof auth.api.getSession>>

    // Inject the token as Bearer so Better Auth's `bearer` plugin validates both
    // what came from the cookie and what came from the header through the same path.
    const session = await auth.api.getSession({
      headers: { authorization: `Bearer ${token}` },
      query,
    })

    if (session?.user) await cacheSession(token, session.user.id, session, SESSION_TTL)
    return session
  }

  // No explicit token → let Better Auth try its own native cookie (backward-compat).
  return auth.api.getSession({ headers: request.headers as HeadersInit, query })
}

export async function invalidateSessionCache(token: string) {
  if (token) await cacheInvalidate(`session:${token}`)
}

/**
 * CSRF protection (double-submit) for the cookie flow. Since the session cookie is
 * `SameSite=None`, the browser sends it on cross-site requests → we require proof that
 * the request came from our frontend: the `X-CSRF-Token` header must match the
 * `csrf_token` cookie.
 *
 * Only applies to writes (POST/PUT/PATCH/DELETE) AUTHENTICATED BY COOKIE. Bearer requests
 * are not subject to CSRF (the browser doesn't attach the `Authorization` header automatically, and
 * non-browser clients — MCP, mobile — aren't subject to CSRF), so they pass straight through.
 * This preserves zero-downtime: legacy Bearer clients keep working without a CSRF header.
 */
export function csrfProtection() {
  return async function (request: FastifyRequest, _reply: FastifyReply) {
    if (SAFE_METHODS.has(request.method.toUpperCase())) return

    const cookies = parseCookies(request)
    if (!cookies[SESSION_COOKIE]) return // not a cookie flow → CSRF doesn't apply

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

    // admin always passes
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
