import { consumeRateLimit, RateLimitResult } from '../../shared/utils/rate-limit.js'

const WINDOW_SECONDS = 60
const MAX_PER_WINDOW = 20

export function checkChatRateLimit(userId: string): Promise<RateLimitResult> {
  return consumeRateLimit(`chat:ratelimit:${userId}`, MAX_PER_WINDOW, WINDOW_SECONDS)
}
