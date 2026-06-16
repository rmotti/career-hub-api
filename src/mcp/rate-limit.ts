import { consumeRateLimit, RateLimitResult } from '../shared/utils/rate-limit.js'

const WINDOW_SECONDS = 60
const MAX_PER_WINDOW = 60

export function checkRateLimit(userId: string): Promise<RateLimitResult> {
  return consumeRateLimit(`mcp:ratelimit:${userId}`, MAX_PER_WINDOW, WINDOW_SECONDS)
}
