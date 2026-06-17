import {
  PrismaClientInitializationError,
  PrismaClientKnownRequestError,
  PrismaClientRustPanicError,
} from '@prisma/client/runtime/library'

/**
 * Graceful-degradation contract for the database (#15).
 *
 * Two layers:
 *  - `isTransientDbError` classifies infra blips (DB unreachable, connection dropped, pool
 *    timeout, engine panic) so the global error handler can surface a typed **503 + Retry-After**
 *    instead of a raw 500. Clients may safely retry idempotent requests on a 503.
 *  - `withDbRetry` auto-retries, but ONLY on `P2024` (pool-acquisition timeout). That error
 *    happens before any statement runs — including the first statement of a transaction — so a
 *    retry can neither double-apply a write nor re-run a statement outside its interactive
 *    transaction. Mid-flight drops (P1001/P1017) are deliberately NOT auto-retried (ambiguous
 *    for writes); they become a 503 and the client decides.
 *
 * There is no write queue: a write that fails after the pool blip is the caller's to retry.
 */

// Infra-level transient errors → 503 (not 500). Not client/data errors.
const TRANSIENT_KNOWN_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024'])

// Pool-acquisition timeout: provably pre-execution, so universally safe to retry.
const POOL_TIMEOUT_CODE = 'P2024'

export function isTransientDbError(error: unknown): boolean {
  if (error instanceof PrismaClientInitializationError) return true
  if (error instanceof PrismaClientRustPanicError) return true
  if (error instanceof PrismaClientKnownRequestError) return TRANSIENT_KNOWN_CODES.has(error.code)
  return false
}

function isPoolTimeout(error: unknown): boolean {
  return error instanceof PrismaClientKnownRequestError && error.code === POOL_TIMEOUT_CODE
}

/**
 * Runs `fn`, retrying only on a connection-pool timeout (P2024) with exponential backoff.
 * Safe to wrap a single query or a whole `$transaction(fn)` call.
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 2
  const baseDelayMs = opts.baseDelayMs ?? 50

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= retries || !isPoolTimeout(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt))
    }
  }
}
