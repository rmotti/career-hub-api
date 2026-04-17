import { FastifyInstance } from 'fastify'
import * as trophiesController from './trophies.controller.js'

export async function trophiesRoutes(app: FastifyInstance) {
  app.get<{ Params: { saveId: string } }>(
    '/saves/:saveId/trophies',
    {
      schema: {
        tags: ['Trophies'],
        summary: 'Listar troféus do save',
        description: 'Retorna todos os troféus com clube e competição associados.',
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
    Body: { competitionId: string; year: number }
  }>(
    '/saves/:saveId/trophies',
    {
      schema: {
        tags: ['Trophies'],
        summary: 'Adicionar troféu',
        description: 'Vincula o troféu ao ClubStint atual do save. Use `GET /api/competitions` para obter os IDs válidos.',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          required: ['competitionId', 'year'],
          properties: {
            competitionId: { type: 'string', description: 'UUID da competição (obtido via /api/competitions)' },
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
