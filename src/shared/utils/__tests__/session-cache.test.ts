import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/redis.js', () => ({
  redis: {
    set: vi.fn(),
    sadd: vi.fn(),
    expire: vi.fn(),
    smembers: vi.fn(),
    del: vi.fn(),
  },
}))

import { redis } from '../../lib/redis.js'
import { cacheSession, invalidateUserSessions } from '../session-cache.js'

const mockedRedis = redis as unknown as {
  set: ReturnType<typeof vi.fn>
  sadd: ReturnType<typeof vi.fn>
  expire: ReturnType<typeof vi.fn>
  smembers: ReturnType<typeof vi.fn>
  del: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  Object.values(mockedRedis).forEach((fn) => fn.mockReset())
})

describe('cacheSession', () => {
  it('caches the session and indexes the token under the user', async () => {
    await cacheSession('tok', 'u1', { user: { id: 'u1' } }, 300)

    expect(mockedRedis.set).toHaveBeenCalledWith('session:tok', expect.any(String), 'EX', 300)
    expect(mockedRedis.sadd).toHaveBeenCalledWith('user-sessions:u1', 'tok')
    expect(mockedRedis.expire).toHaveBeenCalledWith('user-sessions:u1', 300)
  })

  it('still caches the session if the reverse index write fails', async () => {
    mockedRedis.sadd.mockRejectedValue(new Error('redis down'))

    await expect(cacheSession('tok', 'u1', {}, 300)).resolves.toBeUndefined()
    expect(mockedRedis.set).toHaveBeenCalled()
  })
})

describe('invalidateUserSessions', () => {
  it('deletes every cached session token of the user plus the index set', async () => {
    mockedRedis.smembers.mockResolvedValue(['t1', 't2'])

    await invalidateUserSessions('u1')

    expect(mockedRedis.smembers).toHaveBeenCalledWith('user-sessions:u1')
    expect(mockedRedis.del).toHaveBeenCalledWith('session:t1', 'session:t2', 'user-sessions:u1')
  })

  it('deletes just the index set when the user has no cached sessions', async () => {
    mockedRedis.smembers.mockResolvedValue([])

    await invalidateUserSessions('u1')

    expect(mockedRedis.del).toHaveBeenCalledWith('user-sessions:u1')
  })

  it('never throws when redis is unavailable', async () => {
    mockedRedis.smembers.mockRejectedValue(new Error('redis down'))

    await expect(invalidateUserSessions('u1')).resolves.toBeUndefined()
  })
})
