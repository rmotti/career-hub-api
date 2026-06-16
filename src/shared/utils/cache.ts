import { redis } from '../lib/redis.js'
import { recordCacheHit, recordCacheMiss } from '../lib/metrics.js'

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const value = await redis.get(key)
    if (!value) {
      recordCacheMiss()
      return null
    }
    recordCacheHit()
    return JSON.parse(value) as T
  } catch {
    recordCacheMiss()
    return null
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds)
  } catch {
    // Silent failure — cache is optional, never breaks the main flow
  }
}

export async function cacheInvalidate(...keys: string[]): Promise<void> {
  try {
    if (keys.length > 0) await redis.del(...keys)
  } catch {
    // Silent failure
  }
}

export async function cacheInvalidatePattern(pattern: string): Promise<void> {
  try {
    let cursor = '0'
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = nextCursor
      if (keys.length > 0) await redis.del(...keys)
    } while (cursor !== '0')
  } catch {
    // Silent failure
  }
}
