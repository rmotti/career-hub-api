import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyReply, FastifyRequest } from 'fastify'

vi.mock('../../lib/auth.js', () => ({
  auth: { api: { getSession: vi.fn() } },
}))
vi.mock('../cache.js', () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheInvalidate: vi.fn(),
}))
vi.mock('../session-cache.js', () => ({
  cacheSession: vi.fn(),
}))

import { auth } from '../../lib/auth.js'
import { cacheGet } from '../cache.js'
import { csrfProtection, extractSessionToken, requireAuth } from '../auth-hooks.js'

const mockedGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>
const mockedCacheGet = cacheGet as unknown as ReturnType<typeof vi.fn>

const reply = {} as FastifyReply

function makeRequest(opts: {
  method?: string
  cookie?: string
  csrfHeader?: string
  authorization?: string
}): FastifyRequest {
  const headers: Record<string, string> = {}
  if (opts.cookie) headers.cookie = opts.cookie
  if (opts.csrfHeader) headers['x-csrf-token'] = opts.csrfHeader
  if (opts.authorization) headers.authorization = opts.authorization
  return {
    method: opts.method ?? 'POST',
    headers,
    url: '/api/saves',
    protocol: 'https',
    hostname: 'api.test',
  } as unknown as FastifyRequest
}

beforeEach(() => {
  mockedGetSession.mockReset()
  mockedCacheGet.mockReset()
  mockedCacheGet.mockResolvedValue(null)
})

describe('csrfProtection (double-submit)', () => {
  it('skips safe methods (GET/HEAD/OPTIONS)', async () => {
    await expect(
      csrfProtection()(makeRequest({ method: 'GET', cookie: 'session_token=t' }), reply),
    ).resolves.toBeUndefined()
  })

  it('skips when the request is not cookie-authenticated (Bearer only)', async () => {
    await expect(
      csrfProtection()(makeRequest({ method: 'POST', authorization: 'Bearer t' }), reply),
    ).resolves.toBeUndefined()
  })

  it('blocks a cookie-authed write with no X-CSRF-Token header (403)', async () => {
    await expect(
      csrfProtection()(makeRequest({ method: 'POST', cookie: 'session_token=t; csrf_token=c' }), reply),
    ).rejects.toMatchObject({ statusCode: 403, code: 'CSRF_TOKEN_INVALID' })
  })

  it('blocks when X-CSRF-Token does not match the csrf_token cookie (403)', async () => {
    await expect(
      csrfProtection()(
        makeRequest({ method: 'POST', cookie: 'session_token=t; csrf_token=c', csrfHeader: 'wrong' }),
        reply,
      ),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('allows a cookie-authed write when header matches the cookie', async () => {
    await expect(
      csrfProtection()(
        makeRequest({ method: 'POST', cookie: 'session_token=t; csrf_token=match', csrfHeader: 'match' }),
        reply,
      ),
    ).resolves.toBeUndefined()
  })
})

describe('extractSessionToken', () => {
  it('prefers the session_token cookie over the Bearer header', () => {
    const req = makeRequest({ cookie: 'session_token=from-cookie', authorization: 'Bearer from-bearer' })
    expect(extractSessionToken(req)).toBe('from-cookie')
  })

  it('falls back to the Bearer header when no cookie is present', () => {
    expect(extractSessionToken(makeRequest({ authorization: 'Bearer only-bearer' }))).toBe('only-bearer')
  })

  it('returns empty string when neither is present', () => {
    expect(extractSessionToken(makeRequest({}))).toBe('')
  })
})

describe('requireAuth cookie path', () => {
  it('validates the cookie token by injecting it as a Bearer header to Better Auth', async () => {
    mockedGetSession.mockResolvedValue({ user: { id: 'u1' }, session: { id: 's1' } })
    const req = makeRequest({ method: 'GET', cookie: 'session_token=cookie-tok' })

    await requireAuth()(req, reply)

    expect(mockedGetSession).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { authorization: 'Bearer cookie-tok' } }),
    )
    expect(req.user).toMatchObject({ id: 'u1' })
  })
})
