import { FastifyInstance } from 'fastify'
import * as controller from './scout-playbooks.controller.js'

const weightsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    overall: { type: 'number', minimum: 0 },
    age: { type: 'number', minimum: 0 },
    historicalFit: { type: 'number', minimum: 0 },
    potential: { type: 'number', minimum: 0 },
    marketValue: { type: 'number', minimum: 0 },
    wage: { type: 'number', minimum: 0 },
  },
}

const preferencesSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    objective: { type: 'string', enum: ['balanced', 'title', 'youth', 'rebuild'] },
    idealAgeMin: { type: 'number', minimum: 15, maximum: 45 },
    idealAgeMax: { type: 'number', minimum: 15, maximum: 45 },
    maxMarketValue: { type: 'number', exclusiveMinimum: 0, description: 'Valor máximo em milhões de €' },
    maxWage: { type: 'number', exclusiveMinimum: 0, description: 'Salário máximo no mesmo formato do dataset FC26' },
  },
}

const playbookSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', nullable: true },
    saveId: { type: 'string', nullable: true },
    name: { type: 'string' },
    weights: weightsSchema,
    preferences: preferencesSchema,
    isDefault: { type: 'boolean', nullable: true },
    createdAt: { type: 'string', format: 'date-time', nullable: true },
    updatedAt: { type: 'string', format: 'date-time', nullable: true },
  },
}

const filtersSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    positions: { type: 'array', items: { type: 'string' } },
    primaryPositions: { type: 'array', items: { type: 'string' } },
    secondaryPositions: { type: 'array', items: { type: 'string' } },
    nations: { type: 'array', items: { type: 'string' } },
    clubs: { type: 'array', items: { type: 'string' } },
    leagues: { type: 'array', items: { type: 'string' } },
    minOvr: { type: 'integer' },
    maxOvr: { type: 'integer' },
    minAge: { type: 'integer' },
    maxAge: { type: 'integer' },
    minPotential: { type: 'integer' },
    maxPotential: { type: 'integer' },
    minMarketValue: { type: 'number' },
    maxMarketValue: { type: 'number' },
    minPace: { type: 'integer' },
    maxPace: { type: 'integer' },
    minHeight: { type: 'integer' },
    maxHeight: { type: 'integer' },
    preferredFoot: { type: 'string', enum: ['Left', 'Right'] },
    traits: { type: 'array', items: { type: 'string' } },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    offset: { type: 'integer', minimum: 0, default: 0 },
    objective: { type: 'string', enum: ['balanced', 'title', 'youth', 'rebuild'] },
  },
}

export async function scoutPlaybooksRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { saveId: string } }>('/scout/playbooks', {
    schema: {
      tags: ['Scout Playbooks'],
      summary: 'Listar playbooks do scout',
      querystring: {
        type: 'object',
        required: ['saveId'],
        properties: {
          saveId: { type: 'string', description: 'UUID do save' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            defaultPlaybook: playbookSchema,
            playbooks: { type: 'array', items: playbookSchema },
          },
        },
      },
    },
  }, controller.listPlaybooksHandler)

  app.get<{ Params: { playbookId: string } }>('/scout/playbooks/:playbookId', {
    schema: {
      tags: ['Scout Playbooks'],
      summary: 'Buscar playbook do scout',
      params: {
        type: 'object',
        required: ['playbookId'],
        properties: {
          playbookId: { type: 'string' },
        },
      },
      response: {
        200: playbookSchema,
      },
    },
  }, controller.getPlaybookHandler)

  app.post('/scout/playbooks', {
    schema: {
      tags: ['Scout Playbooks'],
      summary: 'Criar playbook do scout',
      body: {
        type: 'object',
        required: ['saveId', 'name', 'weights'],
        properties: {
          saveId: { type: 'string' },
          name: { type: 'string', minLength: 1, maxLength: 80 },
          weights: weightsSchema,
          preferences: preferencesSchema,
          isDefault: { type: 'boolean', default: false },
        },
      },
      response: {
        201: playbookSchema,
      },
    },
  }, controller.createPlaybookHandler)

  app.patch<{ Params: { playbookId: string } }>('/scout/playbooks/:playbookId', {
    schema: {
      tags: ['Scout Playbooks'],
      summary: 'Atualizar playbook do scout',
      params: {
        type: 'object',
        required: ['playbookId'],
        properties: {
          playbookId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 80 },
          weights: weightsSchema,
          preferences: preferencesSchema,
          isDefault: { type: 'boolean' },
        },
      },
      response: {
        200: playbookSchema,
      },
    },
  }, controller.updatePlaybookHandler)

  app.delete<{ Params: { playbookId: string } }>('/scout/playbooks/:playbookId', {
    schema: {
      tags: ['Scout Playbooks'],
      summary: 'Deletar playbook do scout',
      params: {
        type: 'object',
        required: ['playbookId'],
        properties: {
          playbookId: { type: 'string' },
        },
      },
    },
  }, controller.deletePlaybookHandler)

  app.post('/scout/evaluate', {
    schema: {
      tags: ['Scout Playbooks'],
      summary: 'Avaliar jogadores com um playbook',
      description: 'Calcula `scoutScore` para os jogadores do dataset FC26 usando pesos configuráveis e o fit histórico quando ele existir.',
      body: {
        type: 'object',
        required: ['saveId'],
        properties: {
          saveId: { type: 'string' },
          filters: filtersSchema,
          playbookId: { type: 'string' },
          playbook: {
            type: 'object',
            properties: {
              name: { type: 'string', maxLength: 80 },
              weights: weightsSchema,
              preferences: preferencesSchema,
            },
          },
        },
      },
    },
  }, controller.evaluateScoutHandler)
}
