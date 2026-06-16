import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/redis.js', () => ({
  redis: {
    incr: vi.fn(),
    expire: vi.fn(),
    ttl: vi.fn(),
  },
}))

import { redis } from '../../lib/redis.js'
import { consumeRateLimit, rateLimit } from '../rate-limit.js'

const mockedRedis = redis as unknown as {
  incr: ReturnType<typeof vi.fn>
  expire: ReturnType<typeof vi.fn>
  ttl: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  Object.values(mockedRedis).forEach((fn) => fn.mockReset())
})

describe('consumeRateLimit', () => {
  it('sets the TTL only on the first hit of the window', async () => {
    mockedRedis.incr.mockResolvedValue(1)

    const res = await consumeRateLimit('k', 30, 60)

    expect(res.ok).toBe(true)
    expect(mockedRedis.expire).toHaveBeenCalledWith('k', 60)
  })

  it('does not reset the TTL on subsequent hits', async () => {
    mockedRedis.incr.mockResolvedValue(2)

    const res = await consumeRateLimit('k', 30, 60)

    expect(res.ok).toBe(true)
    expect(mockedRedis.expire).not.toHaveBeenCalled()
  })

  it('blocks once the count passes max and returns the remaining TTL', async () => {
    mockedRedis.incr.mockResolvedValue(31)
    mockedRedis.ttl.mockResolvedValue(42)

    const res = await consumeRateLimit('k', 30, 60)

    expect(res).toEqual({ ok: false, retryAfter: 42 })
  })

  it('falls back to the window size when the TTL is unavailable', async () => {
    mockedRedis.incr.mockResolvedValue(31)
    mockedRedis.ttl.mockResolvedValue(-1)

    const res = await consumeRateLimit('k', 30, 60)

    expect(res).toEqual({ ok: false, retryAfter: 60 })
  })

  it('fails open when Redis throws', async () => {
    mockedRedis.incr.mockRejectedValue(new Error('redis down'))

    const res = await consumeRateLimit('k', 30, 60)

    expect(res.ok).toBe(true)
  })
})

describe('rateLimit preHandler', () => {
  function makeReply() {
    const reply = {
      header: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    }
    return reply
  }

  it('keys the bucket by user id and passes through when under the limit', async () => {
    mockedRedis.incr.mockResolvedValue(1)
    const preHandler = rateLimit({ bucket: 'scouting', max: 30 })
    const reply = makeReply()

    await preHandler({ user: { id: 'u1' } } as never, reply as never)

    expect(mockedRedis.incr).toHaveBeenCalledWith('ratelimit:scouting:u1')
    expect(reply.status).not.toHaveBeenCalled()
  })

  it('replies 429 with Retry-After when the limit is exceeded', async () => {
    mockedRedis.incr.mockResolvedValue(31)
    mockedRedis.ttl.mockResolvedValue(15)
    const preHandler = rateLimit({ bucket: 'scouting', max: 30 })
    const reply = makeReply()

    await preHandler({ user: { id: 'u1' } } as never, reply as never)

    expect(reply.header).toHaveBeenCalledWith('Retry-After', '15')
    expect(reply.status).toHaveBeenCalledWith(429)
  })

  it('is a no-op when there is no resolved user', async () => {
    const preHandler = rateLimit({ bucket: 'scouting', max: 30 })
    const reply = makeReply()

    await preHandler({ user: undefined } as never, reply as never)

    expect(mockedRedis.incr).not.toHaveBeenCalled()
    expect(reply.status).not.toHaveBeenCalled()
  })
})
