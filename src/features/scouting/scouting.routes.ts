import { FastifyInstance } from 'fastify'
import * as controller from './scouting.controller.js'
import { rateLimit } from '../../shared/utils/rate-limit.js'

export async function scoutingRoutes(app: FastifyInstance) {
  // Every scouting endpoint hits the fit-score service / dataset — limit per user.
  app.addHook('preHandler', rateLimit({ bucket: 'scouting', max: 30 }))

  app.get('/scouting/saves/:saveId/gaps', {
    schema: {
      tags: ['Scouting'],
      summary: 'Identifica lacunas no elenco do clube ativo da save',
      params: {
        type: 'object',
        required: ['saveId'],
        properties: { saveId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
          formation: { type: 'string', enum: ['4-3-3', '4-2-3-1'] },
        },
      },
    },
  }, controller.identifyGapsHandler)

  app.get('/scouting/transfer-targets', {
    schema: {
      tags: ['Scouting'],
      summary: 'Busca alvos de transferência no dataset FC26',
      querystring: {
        type: 'object',
        required: ['position'],
        properties: {
          position: { type: 'string' },
          maxAge: { type: 'integer' },
          minOverall: { type: 'integer' },
          maxValue: { type: 'number' },
          saveId: { type: 'string' },
        },
      },
    },
  }, controller.searchTransferTargetsHandler)

  app.get('/scouting/saves/:saveId/evaluate/:sofifaId', {
    schema: {
      tags: ['Scouting'],
      summary: 'Avalia o encaixe de um jogador específico (sofifaId) no save',
      params: {
        type: 'object',
        required: ['saveId', 'sofifaId'],
        properties: {
          saveId: { type: 'string' },
          sofifaId: { type: 'string', pattern: '^[0-9]+$' },
        },
      },
    },
  }, controller.evaluateSigningFitHandler)

  app.get('/scouting/saves/:saveId/archetype', {
    schema: {
      tags: ['Scouting'],
      summary: 'Arquétipo histórico do clube para uma posição',
      description: 'Retorna o perfil típico de jogador que o clube ativo costuma contratar nessa posição — idade, nacionalidades e ligas de origem mais frequentes — derivado do histórico real de transferências do fit-score-svc.',
      params: {
        type: 'object',
        required: ['saveId'],
        properties: { saveId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        required: ['position'],
        properties: {
          position: {
            type: 'string',
            enum: ['GOL', 'ZAG', 'LD', 'LE', 'VOL', 'MC', 'MD', 'ME', 'MEI', 'PD', 'PE', 'SA', 'ATA'],
            description: 'Posição FC26 (ex: ATA, MEI, ZAG)',
          },
          objective: {
            type: 'string',
            enum: ['balanced', 'title', 'youth', 'rebuild'],
            default: 'balanced',
          },
        },
      },
    },
  }, controller.getClubArchetypeHandler)
}
