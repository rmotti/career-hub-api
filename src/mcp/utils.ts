import { prisma } from '../shared/lib/prisma.js'
import type { McpContext } from './context.js'

/**
 * Resolves which save a tool should act on. Precedence:
 *   1. `given` — an explicit `saveId` the model passed (e.g. user asked about another save)
 *   2. `fallback` — the save the conversation is pinned to (`ctx.saveId`)
 *   3. the user's most recently updated save
 * Returns null when the user has no saves at all.
 */
export async function resolveSaveId(
  userId: string,
  given: string | undefined,
  fallback?: string,
): Promise<string | null> {
  if (given) return given
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
