import { prisma } from '../shared/lib/prisma.js'
import type { McpContext } from './context.js'

/**
 * Resolves which save a tool should act on. Precedence:
 *   1. `given` — an explicit `saveId` the model passed (e.g. user asked about another save),
 *      but ONLY if it actually belongs to the user. The model sometimes hallucinates a saveId
 *      even though the persona tells it never to pass one; trusting it blindly poisons the call
 *      downstream (assertSaveAccess throws NotFound, which the model paraphrases to the user as
 *      "I can't access the save"). So an unowned/bogus `given` is ignored, not propagated.
 *   2. `fallback` — the save the conversation is pinned to (`ctx.saveId`).
 *   3. the user's most recently updated save.
 * Returns null when the user has no saves at all.
 */
export async function resolveSaveId(
  userId: string,
  given: string | undefined,
  fallback?: string,
): Promise<string | null> {
  if (given) {
    const owned = await prisma.save.findFirst({
      where: { id: given, userId },
      select: { id: true },
    })
    if (owned) return owned.id
    // Bogus/unowned id from the model — fall through to the pinned/most-recent save.
  }
  if (fallback) return fallback
  const save = await prisma.save.findFirst({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  })
  return save?.id ?? null
}

/** Convenience: resolve the active save for a tool call from the MCP context. */
export function resolveCtxSaveId(ctx: McpContext, given?: string): Promise<string | null> {
  return resolveSaveId(ctx.userId, given, ctx.saveId)
}
