import { FastifyInstance } from 'fastify'
import * as trophiesController from './trophies.controller.js'

export async function trophiesRoutes(app: FastifyInstance) {
  app.get<{ Params: { saveId: string } }>(
    '/saves/:saveId/trophies',
    {
      schema: {
        tags: ['Trophies'],
        summary: 'Listar troféus do save',
        description: 'Retorna todos os troféus com o nome do clube (via ClubStint).',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string' },
          },
        },
      },
    },
    trophiesController.listTrophies
  )

  app.post<{
    Params: { saveId: string }
    Body: { name: string; year: number }
  }>(
    '/saves/:saveId/trophies',
    {
      schema: {
        tags: ['Trophies'],
        summary: 'Adicionar troféu',
        description: 'Vincula o troféu ao ClubStint atual do save.',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          required: ['name', 'year'],
          properties: {
            name: { type: 'string', minLength: 1, example: 'Premier League' },
            year: { type: 'integer', example: 2027 },
          },
        },
      },
    },
    trophiesController.createTrophy
  )

  app.delete<{ Params: { saveId: string; id: string } }>(
    '/saves/:saveId/trophies/:id',
    {
      schema: {
        tags: ['Trophies'],
        summary: 'Deletar troféu',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string' },
            id: { type: 'string' },
          },
        },
      },
    },
    trophiesController.deleteTrophy
  )
}
