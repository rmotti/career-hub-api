import { redis } from '../lib/redis.js'
import { cacheSet } from './cache.js'

const sessionKey = (token: string) => `session:${token}`
const userSessionsKey = (userId: string) => `user-sessions:${userId}`

/**
 * Cacheia a sessão e mantém um índice reverso `user-sessions:<userId>` -> tokens,
 * para permitir revogação em lote quando o usuário é banido ou tem o plano alterado.
 * O índice é best-effort: falhas nele nunca quebram o fluxo de autenticação.
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
    // Silent failure — índice é opcional
  }
}

/**
 * Invalida TODAS as sessões cacheadas de um usuário. Chamado quando o usuário muda
 * no banco (ban, troca de role/plano) via `databaseHooks` do Better Auth, fechando a
 * janela de até 5 min em que o cache serviria uma sessão obsoleta.
 */
export async function invalidateUserSessions(userId: string): Promise<void> {
  try {
    const tokens = await redis.smembers(userSessionsKey(userId))
    const keys = [...tokens.map(sessionKey), userSessionsKey(userId)]
    await redis.del(...keys)
  } catch {
    // Silent failure — cache é opcional
  }
}
