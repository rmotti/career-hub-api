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

import { auth } from '../../lib/auth.js'
import { cacheGet } from '../cache.js'
import { requirePlan } from '../auth-hooks.js'

const mockedGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>
const mockedCacheGet = cacheGet as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockedGetSession.mockReset()
  mockedCacheGet.mockReset()
  mockedCacheGet.mockResolvedValue(null) // cache miss → resolve via Better Auth
})

const reply = {} as FastifyReply

function makeRequest(): FastifyRequest {
  return {
    headers: { authorization: 'Bearer tok' },
    url: '/api/scout/evaluate',
    protocol: 'http',
    hostname: 'localhost',
  } as unknown as FastifyRequest
}

function sessionWith(user: Record<string, unknown>) {
  return { user, session: { id: 'sess' } }
}

describe('requirePlan', () => {
  it('blocks a FREE user from a PRO route with 403', async () => {
    mockedGetSession.mockResolvedValue(sessionWith({ id: 'u', plan: 'FREE' }))

    await expect(requirePlan('PRO')(makeRequest(), reply)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('treats a user without an explicit plan as FREE', async () => {
    mockedGetSession.mockResolvedValue(sessionWith({ id: 'u' }))

    await expect(requirePlan('PRO')(makeRequest(), reply)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('allows a PRO user and populates request.user', async () => {
    mockedGetSession.mockResolvedValue(sessionWith({ id: 'u', plan: 'PRO' }))
    const req = makeRequest()

    await expect(requirePlan('PRO')(req, reply)).resolves.toBeUndefined()
    expect(req.user).toMatchObject({ id: 'u', plan: 'PRO' })
  })

  it('allows a PREMIUM user on a PRO route (hierarchy)', async () => {
    mockedGetSession.mockResolvedValue(sessionWith({ id: 'u', plan: 'PREMIUM' }))

    await expect(requirePlan('PRO')(makeRequest(), reply)).resolves.toBeUndefined()
  })

  it('lets an admin bypass the plan check regardless of plan', async () => {
    mockedGetSession.mockResolvedValue(sessionWith({ id: 'u', plan: 'FREE', role: 'admin' }))

    await expect(requirePlan('PRO')(makeRequest(), reply)).resolves.toBeUndefined()
  })

  it('rejects an unauthenticated request with 401', async () => {
    mockedGetSession.mockResolvedValue(null)

    await expect(requirePlan('PRO')(makeRequest(), reply)).rejects.toMatchObject({ statusCode: 401 })
  })
})
