import { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { AppError, NotFoundError } from './errors.js'

/**
 * Confirms the save exists AND belongs to the authenticated user.
 * Throws NotFoundError (404) — not 403 — to avoid leaking the existence of other users' saves,
 * mirroring the `saves` module's behavior.
 */
export async function assertSaveAccess(saveId: string, userId: string) {
  const save = await prisma.save.findFirst({
    where: { id: saveId, userId },
    select: { id: true },
  })

  if (!save) throw new NotFoundError('Save não encontrado.')
}

/**
 * preHandler for routes with `:saveId` in the path. Enforces object-level authorization
 * (prevents IDOR/BOLA): only proceeds if the save belongs to `request.user`.
 *
 * Must run after `requireAuth()`, which populates `request.user`.
 */
export function requireSaveOwnership() {
  return async function (request: FastifyRequest, _reply: FastifyReply) {
    const userId = request.user?.id
    if (!userId) throw new AppError('Não autenticado.', 401)

    const { saveId } = request.params as { saveId?: string }
    if (saveId) await assertSaveAccess(saveId, userId)
  }
}