import { FastifyInstance } from 'fastify'
import * as controller from './saved-searches.controller.js'

const filtersSchema = { type: 'object', additionalProperties: true }

export async function savedSearchesRoutes(app: FastifyInstance) {
  app.get('/saves/:saveId/saved-searches', {
    schema: {
      tags: ['Saved Searches'],
      summary: 'Listar buscas salvas do save',
      params: {
        type: 'object',
        required: ['saveId'],
        properties: { saveId: { type: 'string' } },
      },
    },
  }, controller.listHandler)

  app.post('/saves/:saveId/saved-searches', {
    schema: {
      tags: ['Saved Searches'],
      summary: 'Criar busca salva',
      params: {
        type: 'object',
        required: ['saveId'],
        properties: { saveId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['name', 'filters'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 80 },
          filters: filtersSchema,
        },
      },
    },
  }, controller.createHandler)

  app.patch('/saves/:saveId/saved-searches/:id', {
    schema: {
      tags: ['Saved Searches'],
      summary: 'Atualizar busca salva',
      params: {
        type: 'object',
        required: ['saveId', 'id'],
        properties: { saveId: { type: 'string' }, id: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 80 },
          filters: filtersSchema,
        },
      },
    },
  }, controller.updateHandler)

  app.delete('/saves/:saveId/saved-searches/:id', {
    schema: {
      tags: ['Saved Searches'],
      summary: 'Deletar busca salva',
      params: {
        type: 'object',
        required: ['saveId', 'id'],
        properties: { saveId: { type: 'string' }, id: { type: 'string' } },
      },
    },
  }, controller.deleteHandler)
}
