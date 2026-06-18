import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'

// Name of the httpOnly cookie carrying the session token (same value as the Bearer).
export const SESSION_COOKIE = 'session_token'
// Name of the NON-httpOnly double-submit CSRF cookie.
export const CSRF_COOKIE = 'csrf_token'
// Header the frontend must echo back on write requests.
export const CSRF_HEADER = 'x-csrf-token'

// Better Auth doesn't customize `session.expiresIn` → defaults to 7 days.
// We keep the cookies' Max-Age aligned with that window.
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
 * Serializes the session/CSRF cookie. The SPA now talks to the API **same-origin** (Vercel
 * rewrites `/api/*` to this API; Vite proxies in dev), so the cookie is first-party and we use
 * `SameSite=Lax` — safer than the old cross-site `SameSite=None; Partitioned`, which existed only
 * because the SPA used to hit the Railway domain directly (Safari ITP then dropped the cross-site
 * cookie → random logouts). No `Domain` is ever set, so the cookie stays **host-only**: required
 * because Vercel's rewrite forwards `Set-Cookie` without rewriting `Domain`. In production we keep
 * `Secure`; in dev (localhost http) we drop it, otherwise the browser rejects the cookie.
 */
function serialize(name: string, value: string, options: CookieOptions): string {
  const segments = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${options.maxAge}`,
  ]
  if (options.httpOnly) segments.push('HttpOnly')

  segments.push('SameSite=Lax')
  if (isProd()) segments.push('Secure')

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