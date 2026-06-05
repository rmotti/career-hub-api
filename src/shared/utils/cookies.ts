import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'

// Nome do cookie httpOnly que carrega o token de sessão (mesmo valor do Bearer).
export const SESSION_COOKIE = 'session_token'
// Nome do cookie NÃO-httpOnly do double-submit CSRF.
export const CSRF_COOKIE = 'csrf_token'
// Header que o frontend deve ecoar nas requisições de escrita.
export const CSRF_HEADER = 'x-csrf-token'

// Better Auth não customiza `session.expiresIn` → default de 7 dias.
// Mantemos o Max-Age dos cookies alinhado a essa janela.
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 604800s

const isProd = () => process.env.NODE_ENV === 'production'

export function parseCookies(request: FastifyRequest): Record<string, string> {
  const header = request.headers.cookie
  if (!header) return {}

  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const name = part.slice(0, idx).trim()
    if (!name) continue
    const value = part.slice(idx + 1).trim()
    try {
      out[name] = decodeURIComponent(value)
    } catch {
      out[name] = value
    }
  }
  return out
}

export function getCookie(request: FastifyRequest, name: string): string | undefined {
  return parseCookies(request)[name]
}

interface CookieOptions {
  maxAge: number
  httpOnly: boolean
}

/**
 * Serializa um cookie cross-site. Em produção exige `SameSite=None; Secure` (obrigatório
 * para domínios diferentes — frontend Vercel × API Railway) e `Partitioned` (CHIPS),
 * espelhando os `defaultCookieAttributes` que o Better Auth já usa. Em dev (localhost http)
 * cai para `SameSite=Lax` sem `Secure`, senão o browser recusa o cookie.
 */
function serialize(name: string, value: string, options: CookieOptions): string {
  const segments = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${options.maxAge}`,
  ]
  if (options.httpOnly) segments.push('HttpOnly')

  if (isProd()) {
    segments.push('Secure', 'SameSite=None', 'Partitioned')
  } else {
    segments.push('SameSite=Lax')
  }

  return segments.join('; ')
}

export function sessionCookie(token: string): string {
  return serialize(SESSION_COOKIE, token, { maxAge: SESSION_MAX_AGE, httpOnly: true })
}

export function csrfCookie(token: string): string {
  return serialize(CSRF_COOKIE, token, { maxAge: SESSION_MAX_AGE, httpOnly: false })
}

export function clearedSessionCookie(): string {
  return serialize(SESSION_COOKIE, '', { maxAge: 0, httpOnly: true })
}

export function clearedCsrfCookie(): string {
  return serialize(CSRF_COOKIE, '', { maxAge: 0, httpOnly: false })
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Comparação em tempo constante para evitar timing oracle no match do CSRF. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}