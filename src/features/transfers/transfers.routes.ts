import { FastifyInstance } from 'fastify'
import { TransferType } from '@prisma/client'
import * as transfersController from './transfers.controller.js'
import { requireSaveOwnership } from '../../shared/utils/save-access.js'

export async function transfersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireSaveOwnership())

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
      type: TransferType
      from: string
      to: string
      fee?: number
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
            type: { type: 'string', enum: ['compra', 'venda', 'emprestimo_entrada', 'emprestimo_saida'] },
            from: { type: 'string', minLength: 1, example: 'Real Madrid' },
            to: { type: 'string', minLength: 1, example: 'Liverpool' },
            fee: { type: 'number', minimum: 0, example: 45, description: 'Em milhões de €: 45 = €45M' },
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
      type?: TransferType
      from?: string
      to?: string
      fee?: number
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
            type: { type: 'string', enum: ['compra', 'venda', 'emprestimo_entrada', 'emprestimo_saida'] },
            from: { type: 'string' },
            to: { type: 'string' },
            fee: { type: 'number', minimum: 0, description: 'Em milhões de €' },
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
        summary: 'Deletar transferência (apenas o registro)',
        description: 'Remove só a linha da transferência, **sem** reverter saldo/elenco. Para desfazer uma transferência por completo (ex.: vendeu o jogador errado), use `POST .../reverse`.',
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

  app.post<{ Params: { saveId: string; tid: string } }>(
    '/saves/:saveId/transfers/:tid/reverse',
    {
      schema: {
        tags: ['Transfers'],
        summary: 'Reverter transferência (desfaz saldo + elenco)',
        description: 'Desfaz os efeitos da transferência: devolve o saldo, recoloca (saída) ou retira (entrada) o jogador do elenco, e apaga o registro. Tira um snapshot de segurança antes.',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string' },
            tid: { type: 'string' },
          },
        },
      },
    },
    transfersController.reverseTransfer
  )
}
