import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyRequest } from 'fastify'
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  clearedCsrfCookie,
  clearedSessionCookie,
  csrfCookie,
  generateCsrfToken,
  getCookie,
  parseCookies,
  safeEqual,
  sessionCookie,
} from '../cookies.js'

function reqWithCookie(header?: string): FastifyRequest {
  return { headers: header ? { cookie: header } : {} } as unknown as FastifyRequest
}

const originalEnv = process.env.NODE_ENV

afterEach(() => {
  process.env.NODE_ENV = originalEnv
})

describe('parseCookies', () => {
  it('parses multiple cookies and trims/decodes values', () => {
    const cookies = parseCookies(reqWithCookie('session_token=abc%20123; csrf_token=xyz; other=1'))
    expect(cookies).toEqual({ session_token: 'abc 123', csrf_token: 'xyz', other: '1' })
  })

  it('returns empty object when there is no cookie header', () => {
    expect(parseCookies(reqWithCookie())).toEqual({})
  })

  it('getCookie reads a single named cookie', () => {
    expect(getCookie(reqWithCookie('session_token=tok'), SESSION_COOKIE)).toBe('tok')
    expect(getCookie(reqWithCookie('session_token=tok'), CSRF_COOKIE)).toBeUndefined()
  })
})

describe('cookie serialization (cross-site attributes)', () => {
  it('production: host-only SameSite=Lax; Secure; httpOnly only on session', () => {
    process.env.NODE_ENV = 'production'

    const session = sessionCookie('the-token')
    expect(session).toContain(`${SESSION_COOKIE}=the-token`)
    expect(session).toContain('Path=/')
    expect(session).toContain(`Max-Age=${SESSION_MAX_AGE}`)
    expect(session).toContain('HttpOnly')
    expect(session).toContain('Secure')
    expect(session).toContain('SameSite=Lax')
    // host-only (Vercel rewrite forwards Set-Cookie without rewriting Domain) and no cross-site CHIPS
    expect(session).not.toContain('Domain')
    expect(session).not.toContain('SameSite=None')
    expect(session).not.toContain('Partitioned')

    const csrf = csrfCookie('csrf-val')
    expect(csrf).toContain(`${CSRF_COOKIE}=csrf-val`)
    expect(csrf).toContain('SameSite=Lax')
    expect(csrf).toContain('Secure')
    expect(csrf).not.toContain('Domain')
    expect(csrf).not.toContain('HttpOnly') // legível pelo JS (double-submit)
  })

  it('development: falls back to SameSite=Lax without Secure (localhost http)', () => {
    process.env.NODE_ENV = 'development'

    const session = sessionCookie('t')
    expect(session).toContain('SameSite=Lax')
    expect(session).not.toContain('Secure')
    expect(session).not.toContain('SameSite=None')
  })

  it('cleared cookies use Max-Age=0', () => {
    process.env.NODE_ENV = 'production'
    expect(clearedSessionCookie()).toContain('Max-Age=0')
    expect(clearedSessionCookie()).toContain('HttpOnly')
    expect(clearedCsrfCookie()).toContain('Max-Age=0')
  })
})

describe('generateCsrfToken / safeEqual', () => {
  it('generates distinct high-entropy tokens', () => {
    const a = generateCsrfToken()
    const b = generateCsrfToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(40)
  })

  it('safeEqual matches identical strings and rejects mismatches/length diffs', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('', '')).toBe(true)
  })
})
