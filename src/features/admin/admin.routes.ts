import { FastifyInstance } from 'fastify'
import * as controller from './admin.controller.js'
import { requireRole } from '../../shared/utils/auth-hooks.js'

export async function adminRoutes(app: FastifyInstance) {
  // Toda rota admin exige role 'admin' (além do requireAuth do plugin pai).
  app.addHook('preHandler', requireRole('admin'))

  app.post('/admin/cache/invalidate', {
    schema: {
      tags: ['Admin'],
      summary: 'Invalida chaves de cache por padrão (lista fechada)',
      description: 'Apaga as chaves do Redis que casam com o padrão. Só padrões permitidos (ex: archetype:*) — exclusivo para admin.',
      body: {
        type: 'object',
        required: ['pattern'],
        properties: {
          pattern: { type: 'string', description: 'Glob de cache permitido, ex: archetype:*:transfers' },
        },
      },
    },
  }, controller.invalidateCacheHandler)
}
