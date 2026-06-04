import { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { AppError, NotFoundError } from './errors.js'

/**
 * Confirma que o save existe E pertence ao usuário autenticado.
 * Lança NotFoundError (404) — não 403 — para não vazar a existência de saves alheios,
 * espelhando o comportamento do módulo `saves`.
 */
export async function assertSaveAccess(saveId: string, userId: string) {
  const save = await prisma.save.findFirst({
    where: { id: saveId, userId },
    select: { id: true },
  })

  if (!save) throw new NotFoundError('Save não encontrado.')
}

/**
 * preHandler para rotas com `:saveId` no path. Garante object-level authorization
 * (impede IDOR/BOLA): só prossegue se o save pertencer a `request.user`.
 *
 * Deve rodar depois de `requireAuth()`, que popula `request.user`.
 */
export function requireSaveOwnership() {
  return async function (request: FastifyRequest, _reply: FastifyReply) {
    const userId = request.user?.id
    if (!userId) throw new AppError('Não autenticado.', 401)

    const { saveId } = request.params as { saveId?: string }
    if (saveId) await assertSaveAccess(saveId, userId)
  }
}