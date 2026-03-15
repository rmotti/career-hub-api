import { FastifyInstance } from 'fastify'
import { listClubs, listClubsByLeague } from '../controllers/clubs.controller'

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

  app.get('/clubs/by-league', {
    schema: {
      tags: ['Clubs'],
      summary: 'Listar clubes agrupados por liga',
      description: 'Retorna um objeto onde cada chave é o nome de uma liga e o valor é a lista de clubes.',
      response: {
        200: {
          type: 'object',
          additionalProperties: {
            type: 'array',
            items: { type: 'string' },
          },
          example: {
            'Premier League': ['Arsenal', 'Liverpool'],
            'La Liga': ['Real Madrid', 'Barcelona'],
          },
        },
      },
    },
  }, listClubsByLeague)
}
