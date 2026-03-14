import { FastifyInstance } from 'fastify'
import * as savesController from '../controllers/saves.controller'

export async function savesRoutes(app: FastifyInstance) {
  app.get('/saves', {
    schema: {
      tags: ['Saves'],
      summary: 'Listar todos os saves',
      description: 'Retorna todos os saves com o `currentClubStint` (clube atual).',
    },
  }, savesController.listSaves)

  app.get<{ Params: { saveId: string } }>('/saves/:saveId', {
    schema: {
      tags: ['Saves'],
      summary: 'Buscar save por ID',
      params: {
        type: 'object',
        properties: {
          saveId: { type: 'string', description: 'UUID do save' },
        },
      },
    },
  }, savesController.getSave)

  app.post<{ Body: { name: string; club: string } }>(
    '/saves',
    {
      schema: {
        tags: ['Saves'],
        summary: 'Criar novo save',
        description: 'Cria um save, um ClubStint inicial e TeamSeasonStats para a temporada 2026/27.',
        body: {
          type: 'object',
          required: ['name', 'club'],
          properties: {
            name: { type: 'string', minLength: 1, description: 'Nome do save' },
            club: { type: 'string', minLength: 1, description: 'Clube inicial (deve existir na lista de /api/clubs)' },
          },
        },
      },
    },
    savesController.createSave
  )

  app.patch<{
    Params: { saveId: string }
    Body: {
      currentYear?: number
      currentSeason?: string
      budget?: string
      balance?: string
    }
  }>(
    '/saves/:saveId',
    {
      schema: {
        tags: ['Saves'],
        summary: 'Atualizar save',
        description: 'Ao alterar `currentSeason`, cria automaticamente TeamSeasonStats e PlayerSeasonStats vazios para a nova temporada.',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string', description: 'UUID do save' },
          },
        },
        body: {
          type: 'object',
          properties: {
            currentYear: { type: 'integer', example: 2027 },
            currentSeason: { type: 'string', example: '2027/28' },
            budget: { type: 'string', example: '£50M' },
            balance: { type: 'string', example: '£12M' },
          },
        },
      },
    },
    savesController.updateSave
  )

  app.delete<{ Params: { saveId: string } }>(
    '/saves/:saveId',
    {
      schema: {
        tags: ['Saves'],
        summary: 'Deletar save',
        description: 'Remove o save e todos os dados relacionados (cascade).',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string', description: 'UUID do save' },
          },
        },
      },
    },
    savesController.deleteSave
  )
}
