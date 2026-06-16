import { FastifyInstance } from 'fastify'
import { TransferType } from '@prisma/client'
import * as transfersController from './transfers.controller.js'
import { requireSaveOwnership } from '../../shared/utils/save-access.js'

const nullableNum = { type: 'number', nullable: true }
const nullableStr = { type: 'string', nullable: true }

const errorResponse = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
    statusCode: { type: 'integer' },
  },
}

// Campos escalares do Transfer + feeFormatted (de formatTransferResponse).
const transferScalarProperties = {
  id: { type: 'string' },
  saveId: { type: 'string' },
  playerId: nullableStr,
  playerName: { type: 'string' },
  type: { type: 'string' },
  from: { type: 'string' },
  to: { type: 'string' },
  fee: nullableNum,
  season: { type: 'string' },
  createdAt: { type: 'string', format: 'date-time' },
  feeFormatted: { type: 'string' },
}

// A listagem embute um resumo do player; as mutações trazem clubStintId.
const transferListItemResponse = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...transferScalarProperties,
    player: {
      type: 'object',
      nullable: true,
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        position: { type: 'string' },
        alternativePosition: {
          type: 'object',
          properties: { positions: { type: 'array', items: { type: 'string' } } },
        },
      },
    },
  },
}

const transferMutationResponse = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...transferScalarProperties,
    clubStintId: nullableStr,
  },
}

// Resumo do save retornado por formatSaveResponse em createTransfer.
const saveSummaryResponse = {
  type: 'object',
  nullable: true,
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    currentSeason: { type: 'string' },
    currentYear: { type: 'integer' },
    balance: nullableNum,
    balanceFormatted: { type: 'string' },
    budget: nullableNum,
    budgetFormatted: { type: 'string' },
  },
}

const createTransferResponse = {
  type: 'object',
  additionalProperties: false,
  properties: {
    transfer: transferMutationResponse,
    playerId: nullableStr,
    save: saveSummaryResponse,
  },
}

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
      response: {
        200: { type: 'array', items: transferListItemResponse },
        404: errorResponse,
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
        response: {
          201: createTransferResponse,
          400: errorResponse,
          404: errorResponse,
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
        response: {
          200: transferMutationResponse,
          400: errorResponse,
          404: errorResponse,
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
        response: {
          204: { type: 'null' },
          404: errorResponse,
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
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            properties: { reversed: { type: 'boolean' } },
          },
          404: errorResponse,
        },
      },
    },
    transfersController.reverseTransfer
  )
}
