import { redis } from '../lib/redis.js'
import { cacheSet } from './cache.js'

const sessionKey = (token: string) => `session:${token}`
const userSessionsKey = (userId: string) => `user-sessions:${userId}`

/**
 * Caches the session and maintains a reverse index `user-sessions:<userId>` -> tokens,
 * to allow batch revocation when the user is banned or has their plan changed.
 * The index is best-effort: failures in it never break the authentication flow.
 */
export async function cacheSession(
  token: string,
  userId: string,
  session: unknown,
  ttlSeconds: number,
): Promise<void> {
  await cacheSet(sessionKey(token), session, ttlSeconds)

  try {
    await redis.sadd(userSessionsKey(userId), token)
    await redis.expire(userSessionsKey(userId), ttlSeconds)
  } catch {
    // Silent failure — the index is optional
  }
}

/**
 * Invalidates ALL of a user's cached sessions. Called when the user changes
 * in the database (ban, role/plan change) via Better Auth's `databaseHooks`, closing the
 * up-to-5-min window in which the cache would serve a stale session.
 */
export async function invalidateUserSessions(userId: string): Promise<void> {
  try {
    const tokens = await redis.smembers(userSessionsKey(userId))
    const keys = [...tokens.map(sessionKey), userSessionsKey(userId)]
    await redis.del(...keys)
  } catch {
    // Silent failure — the cache is optional
  }
}
