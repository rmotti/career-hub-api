import { FastifyInstance } from 'fastify'
import { listFc26PlayersHandler, getFc26PlayerHandler } from './fc26-players.controller.js'

const fc26PlayerSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    sofifaId: { type: 'integer' },
    name: { type: 'string' },
    positions: { type: 'array', items: { type: 'string' } },
    age: { type: 'integer' },
    ovr: { type: 'integer' },
    potential: { type: 'integer' },
    marketValue: { type: 'number', nullable: true },
    nation: { type: 'string', nullable: true },
    club: { type: 'string', nullable: true },
    wage: { type: 'number', nullable: true },
  },
}

export async function fc26PlayersRoutes(app: FastifyInstance) {
  app.get('/fc26-players', {
    schema: {
      tags: ['FC26 Players'],
      summary: 'Listar jogadores do dataset FC26',
      description: 'Retorna jogadores do dataset FC26 com filtros opcionais. Usado pelo módulo Scout para busca de candidatos.',
      querystring: {
        type: 'object',
        properties: {
          positions: {
            type: 'string',
            description: 'Posições separadas por vírgula (ex: MC,ATA)',
            example: 'MC,ATA',
          },
          minOvr: { type: 'integer', description: 'OVR mínimo', example: 75 },
          maxOvr: { type: 'integer', description: 'OVR máximo', example: 90 },
          minAge: { type: 'integer', description: 'Idade mínima', example: 18 },
          maxAge: { type: 'integer', description: 'Idade máxima', example: 28 },
          minPotential: { type: 'integer', description: 'Potential mínimo', example: 80 },
          nation: { type: 'string', description: 'Filtro por nacionalidade (parcial)', example: 'Brazil' },
          limit: { type: 'integer', description: 'Máximo de resultados (max: 100)', default: 20, example: 20 },
          offset: { type: 'integer', description: 'Paginação', default: 0, example: 0 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            players: { type: 'array', items: fc26PlayerSchema },
            total: { type: 'integer', description: 'Total de registros para os filtros aplicados' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
          },
        },
      },
    },
  }, listFc26PlayersHandler)

  app.get('/fc26-players/:sofifaId', {
    schema: {
      tags: ['FC26 Players'],
      summary: 'Buscar jogador FC26 por sofifaId',
      params: {
        type: 'object',
        required: ['sofifaId'],
        properties: {
          sofifaId: { type: 'integer', description: 'ID do jogador no dataset FC26', example: 158023 },
        },
      },
      response: {
        200: fc26PlayerSchema,
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            statusCode: { type: 'integer' },
          },
        },
      },
    },
  }, getFc26PlayerHandler)
}
