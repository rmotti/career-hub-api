import { FastifyInstance } from 'fastify'
import * as transfersController from '../controllers/transfers.controller'

export async function transfersRoutes(app: FastifyInstance) {
  app.get<{
    Params: { saveId: string }
    Querystring: { season?: string }
  }>('/saves/:saveId/transfers', {
    schema: {
      tags: ['Transfers'],
      summary: 'Listar transferências',
      description: 'Com `?season=current`: filtra pela `currentSeason` do save. Sem query param: retorna todas.',
      params: {
        type: 'object',
        properties: {
          saveId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          season: { type: 'string', enum: ['current'], description: 'Use "current" para filtrar pela temporada atual' },
        },
      },
    },
  }, transfersController.listTransfers)

  app.post<{
    Params: { saveId: string }
    Body: {
      playerName: string
      type: string
      from: string
      to: string
      fee?: string
      season: string
      playerId?: string
    }
  }>(
    '/saves/:saveId/transfers',
    {
      schema: {
        tags: ['Transfers'],
        summary: 'Registrar transferência',
        description: `**compra**: cria ou reativa jogador, vincula ao elenco e gera PlayerSeasonStats.
**venda**: desvincula o jogador do elenco ativo.
Toda a operação é feita em transação Prisma.`,
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          required: ['playerName', 'type', 'from', 'to', 'season'],
          properties: {
            playerName: { type: 'string', minLength: 1, example: 'Kylian Mbappé' },
            type: { type: 'string', enum: ['compra', 'venda'] },
            from: { type: 'string', minLength: 1, example: 'Real Madrid' },
            to: { type: 'string', minLength: 1, example: 'Liverpool' },
            fee: { type: 'string', example: '£80M' },
            season: { type: 'string', pattern: '^\\d{4}\\/\\d{2}$', example: '2027/28' },
            playerId: { type: 'string', description: 'UUID do player já existente no save (opcional)' },
          },
        },
      },
    },
    transfersController.createTransfer
  )

  app.put<{
    Params: { saveId: string; tid: string }
    Body: {
      playerName?: string
      type?: string
      from?: string
      to?: string
      fee?: string
      season?: string
    }
  }>(
    '/saves/:saveId/transfers/:tid',
    {
      schema: {
        tags: ['Transfers'],
        summary: 'Atualizar transferência',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string' },
            tid: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          properties: {
            playerName: { type: 'string' },
            type: { type: 'string', enum: ['compra', 'venda'] },
            from: { type: 'string' },
            to: { type: 'string' },
            fee: { type: 'string' },
            season: { type: 'string', pattern: '^\\d{4}\\/\\d{2}$' },
          },
        },
      },
    },
    transfersController.updateTransfer
  )

  app.delete<{ Params: { saveId: string; tid: string } }>(
    '/saves/:saveId/transfers/:tid',
    {
      schema: {
        tags: ['Transfers'],
        summary: 'Deletar transferência',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string' },
            tid: { type: 'string' },
          },
        },
      },
    },
    transfersController.deleteTransfer
  )
}
