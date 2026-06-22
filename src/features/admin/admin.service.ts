import { cacheInvalidatePattern } from '../../shared/utils/cache.js'
import { AppError } from '../../shared/utils/errors.js'

/**
 * Padrões de cache que um admin pode invalidar sob demanda. Lista fechada de propósito:
 * impede um `*` acidental que apagaria sessões de auth, rate-limit, competições etc.
 * (um FLUSHALL disfarçado). Cada entrada é um glob aceito pelo SCAN do Redis.
 */
const ALLOWED_PATTERNS = new Set<string>([
  'archetype:*',
  'archetype:*:transfers',
])

export async function invalidateCache(pattern: string): Promise<{ pattern: string }> {
  if (!ALLOWED_PATTERNS.has(pattern)) {
    throw new AppError(
      `Padrão não permitido: '${pattern}'. Permitidos: ${[...ALLOWED_PATTERNS].join(', ')}.`,
      400,
    )
  }

  await cacheInvalidatePattern(pattern)
  return { pattern }
}
