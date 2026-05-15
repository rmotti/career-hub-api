import { redis } from '../shared/lib/redis.js'

const WINDOW_SECONDS = 60
const MAX_PER_WINDOW = 60

export async function checkRateLimit(userId: string): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const key = `mcp:ratelimit:${userId}`
  try {
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, WINDOW_SECONDS)
    if (count > MAX_PER_WINDOW) {
      const ttl = await redis.ttl(key)
      return { ok: false, retryAfter: ttl > 0 ? ttl : WINDOW_SECONDS }
    }
    return { ok: true }
  } catch {
    return { ok: true }
  }
}
