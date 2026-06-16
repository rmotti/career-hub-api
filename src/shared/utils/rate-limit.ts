import { FastifyRequest, FastifyReply } from 'fastify'
import { redis } from '../lib/redis.js'

export interface RateLimitResult {
  ok: boolean
  /** Segundos até a janela resetar (presente quando `ok` é false). */
  retryAfter: number
}

/**
 * Counter de janela fixa por chave no Redis. Falha aberto (retorna `ok: true`)
 * quando o Redis está indisponível — nunca derruba o fluxo principal.
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
 * preHandler factory: limita por `request.user.id` em um bucket nomeado.
 * Deve ser registrado num escopo que já rodou `requireAuth()` (user presente).
 * Responde 429 com header `Retry-After` quando excedido.
 */
export function rateLimit(options: RouteRateLimitOptions) {
  const { bucket, max, windowSeconds = 60 } = options

  return async function rateLimitPreHandler(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.id
    if (!userId) return // sem usuário resolvido, deixa o requireAuth/handler decidir

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
