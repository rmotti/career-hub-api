import { FastifyRequest, FastifyReply } from 'fastify'
import { auth } from '../lib/auth'
import { AppError } from './errors'

type UserRole = 'ADMIN' | 'USER'
type UserPlan = 'FREE' | 'PRO' | 'PREMIUM'

const PLAN_HIERARCHY: Record<UserPlan, number> = {
  FREE: 0,
  PRO: 1,
  PREMIUM: 2,
}

async function getSession(request: FastifyRequest) {
  const url = new URL(request.url, `${request.protocol}://${request.hostname}`)
  const session = await auth.api.getSession({
    headers: request.headers as HeadersInit,
    query: Object.fromEntries(url.searchParams),
  })
  return session
}

export function requireAuth() {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const session = await getSession(request)

    if (!session?.user) {
      throw new AppError('Não autenticado.', 401)
    }

    request.user = session.user
    request.session = session.session
  }
}

export function requireRole(role: UserRole) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const session = await getSession(request)

    if (!session?.user) {
      throw new AppError('Não autenticado.', 401)
    }

    const userRole = (session.user as { role?: string }).role as UserRole | undefined

    if (userRole !== role) {
      throw new AppError('Acesso negado.', 403)
    }

    request.user = session.user
    request.session = session.session
  }
}

export function requirePlan(minimumPlan: UserPlan) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const session = await getSession(request)

    if (!session?.user) {
      throw new AppError('Não autenticado.', 401)
    }

    const userPlan = ((session.user as { plan?: string }).plan ?? 'FREE') as UserPlan
    const userRole = (session.user as { role?: string }).role as UserRole | undefined

    // admin sempre passa
    if (userRole === 'ADMIN') {
      request.user = session.user
      request.session = session.session
      return
    }

    if (PLAN_HIERARCHY[userPlan] < PLAN_HIERARCHY[minimumPlan]) {
      throw new AppError(`Esta funcionalidade requer o plano ${minimumPlan} ou superior.`, 403)
    }

    request.user = session.user
    request.session = session.session
  }
}
