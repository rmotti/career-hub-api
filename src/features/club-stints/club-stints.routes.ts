import { FastifyInstance } from 'fastify'
import * as clubStintsController from './club-stints.controller.js'
import { requireSaveOwnership } from '../../shared/utils/save-access.js'

export async function clubStintsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireSaveOwnership())

  app.get<{ Params: { saveId: string } }>(
    '/saves/:saveId/club-stints',
    {
      schema: {
        tags: ['Club Stints'],
        summary: 'Listar passagens por clubes',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string', description: 'UUID do save' },
          },
        },
      },
    },
    clubStintsController.listClubStints
  )

  app.get<{ Params: { saveId: string } }>(
    '/saves/:saveId/club-stints/current',
    {
      schema: {
        tags: ['Club Stints'],
        summary: 'Buscar clube atual',
        description: 'Retorna o ClubStint com `isCurrent: true`.',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string', description: 'UUID do save' },
          },
        },
      },
    },
    clubStintsController.getCurrentClubStint
  )

  app.post<{ Params: { saveId: string }; Body: { club: string; europeanCompetitionId?: string | null } }>(
    '/saves/:saveId/club-stints',
    {
      schema: {
        tags: ['Club Stints'],
        summary: 'Mudar de clube',
        description: 'Operação crítica em transação: fecha o stint atual, abre um novo, cria TeamSeasonStats por competição do país e desvincula todos os jogadores.',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string', description: 'UUID do save' },
          },
        },
        body: {
          type: 'object',
          required: ['club'],
          properties: {
            club: { type: 'string', minLength: 1, description: 'Nome do novo clube (deve existir em /api/clubs)' },
            europeanCompetitionId: { type: 'string', nullable: true, description: 'UUID da competição europeia para a temporada atual. Se omitido, reaproveita a europeia do stint atual quando existir.' },
          },
        },
      },
    },
    clubStintsController.createClubStint
  )

  app.patch<{
    Params: { saveId: string; stintId: string }
    Body: { club?: string; startYear?: string; endYear?: string }
  }>(
    '/saves/:saveId/club-stints/:stintId',
    {
      schema: {
        tags: ['Club Stints'],
        summary: 'Atualizar dados da passagem',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string' },
            stintId: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          properties: {
            club: { type: 'string' },
            startYear: { type: 'string', example: '2026' },
            endYear: { type: 'string', example: '2028' },
          },
        },
      },
    },
    clubStintsController.updateClubStint
  )
}
