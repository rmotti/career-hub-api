import { FastifyInstance } from 'fastify'
import * as controller from './shortlist.controller.js'

const prioritySchema = { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'], nullable: true }

export async function shortlistRoutes(app: FastifyInstance) {
  app.get('/saves/:saveId/shortlist', {
    schema: {
      tags: ['Shortlist'],
      summary: 'Listar jogadores na shortlist do save',
      params: {
        type: 'object',
        required: ['saveId'],
        properties: { saveId: { type: 'string' } },
      },
    },
  }, controller.listShortlistHandler)

  app.post('/saves/:saveId/shortlist', {
    schema: {
      tags: ['Shortlist'],
      summary: 'Adicionar jogador à shortlist',
      params: {
        type: 'object',
        required: ['saveId'],
        properties: { saveId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['fc26PlayerId'],
        properties: {
          fc26PlayerId: { type: 'integer' },
          notes: { type: 'string', maxLength: 500, nullable: true },
          priority: prioritySchema,
        },
      },
    },
  }, controller.addShortlistHandler)

  app.patch('/saves/:saveId/shortlist/:itemId', {
    schema: {
      tags: ['Shortlist'],
      summary: 'Atualizar item da shortlist',
      params: {
        type: 'object',
        required: ['saveId', 'itemId'],
        properties: { saveId: { type: 'string' }, itemId: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          notes: { type: 'string', maxLength: 500, nullable: true },
          priority: prioritySchema,
        },
      },
    },
  }, controller.updateShortlistHandler)

  app.delete('/saves/:saveId/shortlist/:itemId', {
    schema: {
      tags: ['Shortlist'],
      summary: 'Remover jogador da shortlist',
      params: {
        type: 'object',
        required: ['saveId', 'itemId'],
        properties: { saveId: { type: 'string' }, itemId: { type: 'string' } },
      },
    },
  }, controller.deleteShortlistHandler)
}
