import { FastifyRequest, FastifyReply } from 'fastify'
import { redis } from '../lib/redis.js'

export interface RateLimitResult {
  ok: boolean
  /** Segundos até a janela resetar (presente quando `ok` é false). */
  retryAfter: number
}

/**
 * Per-key fixed-window counter in Redis. Fails open (returns `ok: true`)
 * when Redis is unavailable — never takes down the main flow.
 */
export async function consumeRateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  try {
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, windowSeconds)
    if (count > max) {
      const ttl = await redis.ttl(key)
      return { ok: false, retryAfter: ttl > 0 ? ttl : windowSeconds }
    }
    return { ok: true, retryAfter: 0 }
  } catch {
    return { ok: true, retryAfter: 0 }
  }
}

export interface RouteRateLimitOptions {
  /** Prefixo da chave Redis, identifica o bucket do endpoint. */
  bucket: string
  /** Máximo de requisições por janela, por usuário. */
  max: number
  /** Tamanho da janela em segundos (default 60). */
  windowSeconds?: number
}

/**
 * preHandler factory: limits per `request.user.id` in a named bucket.
 * Must be registered in a scope that already ran `requireAuth()` (user present).
 * Responds 429 with a `Retry-After` header when exceeded.
 */
export function rateLimit(options: RouteRateLimitOptions) {
  const { bucket, max, windowSeconds = 60 } = options

  return async function rateLimitPreHandler(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.id
    if (!userId) return // no resolved user, let requireAuth/handler decide

    const rl = await consumeRateLimit(`ratelimit:${bucket}:${userId}`, max, windowSeconds)
    if (!rl.ok) {
      reply.header('Retry-After', String(rl.retryAfter))
      return reply.status(429).send({
        error: 'Rate limit excedido. Aguarde antes de tentar novamente.',
        statusCode: 429,
      })
    }
  }
}
