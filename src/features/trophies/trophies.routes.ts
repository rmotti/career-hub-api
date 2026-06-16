import { FastifyInstance } from 'fastify'
import * as trophiesController from './trophies.controller.js'
import { requireSaveOwnership } from '../../shared/utils/save-access.js'

const errorResponse = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
    statusCode: { type: 'integer' },
  },
}

const trophyResponse = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    year: { type: 'integer' },
    createdAt: { type: 'string', format: 'date-time' },
    clubStintId: { type: 'string' },
    club: { type: 'string' },
    competition: {
      type: 'object',
      nullable: true,
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        type: { type: 'string' },
      },
    },
  },
}

export async function trophiesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireSaveOwnership())

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
        response: {
          200: { type: 'array', items: trophyResponse },
          404: errorResponse,
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
        response: {
          201: trophyResponse,
          400: errorResponse,
          404: errorResponse,
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
        response: {
          204: { type: 'null' },
          404: errorResponse,
        },
      },
    },
    trophiesController.deleteTrophy
  )
}
