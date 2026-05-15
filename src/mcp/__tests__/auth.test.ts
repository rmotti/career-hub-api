import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../shared/lib/auth.js', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('../../shared/utils/cache.js', () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
}))

import { auth } from '../../shared/lib/auth.js'
import { cacheGet, cacheSet } from '../../shared/utils/cache.js'
import { AppError } from '../../shared/utils/errors.js'
import { resolveMcpContext } from '../auth.js'

function mockReq(headers: Record<string, string>) {
  return { headers } as unknown as Parameters<typeof resolveMcpContext>[0]
}

describe('resolveMcpContext', () => {
  beforeEach(() => {
    vi.mocked(cacheGet).mockReset()
    vi.mocked(cacheSet).mockReset()
    vi.mocked(auth.api.getSession).mockReset()
  })

  it('throws 401 when authorization header is missing', async () => {
    await expect(resolveMcpContext(mockReq({}))).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('returns cached userId without calling auth.api.getSession', async () => {
    vi.mocked(cacheGet).mockResolvedValue({ userId: 'user-1' })

    const ctx = await resolveMcpContext(mockReq({ authorization: 'Bearer tok-abc' }))

    expect(ctx).toEqual({ userId: 'user-1', sessionToken: 'tok-abc' })
    expect(auth.api.getSession).not.toHaveBeenCalled()
  })

  it('resolves session via better-auth and caches it on cache miss', async () => {
    vi.mocked(cacheGet).mockResolvedValue(null)
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-2' },
      session: {},
    } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>)

    const ctx = await resolveMcpContext(mockReq({ authorization: 'Bearer tok-xyz' }))

    expect(ctx).toEqual({ userId: 'user-2', sessionToken: 'tok-xyz' })
    expect(cacheSet).toHaveBeenCalledWith('mcp:session:tok-xyz', { userId: 'user-2' }, 300)
  })

  it('throws 401 when better-auth returns no session', async () => {
    vi.mocked(cacheGet).mockResolvedValue(null)
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    await expect(
      resolveMcpContext(mockReq({ authorization: 'Bearer bad' })),
    ).rejects.toBeInstanceOf(AppError)
  })
})
