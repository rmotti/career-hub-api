import { Session } from '../shared/lib/auth.js'

declare module 'fastify' {
  interface FastifyRequest {
    user: Session['user'] | undefined
    session: Session['session'] | undefined
  }
}
