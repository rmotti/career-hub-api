import { FastifyInstance } from 'fastify'
import { listClubs } from '../controllers/clubs.controller'

export async function clubsRoutes(app: FastifyInstance) {
  app.get('/clubs', {
    schema: {
      tags: ['Clubs'],
      summary: 'Listar todos os clubes disponíveis',
      response: {
        200: {
          type: 'array',
          items: { type: 'string' },
          example: ['Liverpool', 'Manchester City', 'Real Madrid'],
        },
      },
    },
  }, listClubs)
}
