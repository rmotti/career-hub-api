import { FastifyInstance } from 'fastify'
import {
  listFc26PlayersHandler,
  getFc26PlayerHandler,
  getFc26FiltersHandler,
} from './fc26-players.controller.js'

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
    league: { type: 'string', nullable: true },
    wage: { type: 'number', nullable: true },
  },
}

export async function fc26PlayersRoutes(app: FastifyInstance) {
  app.get('/fc26-players/filters', {
    schema: {
      tags: ['FC26 Players'],
      summary: 'Metadados para dropdowns de filtros',
      description: 'Retorna valores distintos do dataset para popular selects no frontend. Cacheado por 24h.',
      response: {
        200: {
          type: 'object',
          properties: {
            positions: { type: 'array', items: { type: 'string' } },
            nations: { type: 'array', items: { type: 'string' } },
            leagues: { type: 'array', items: { type: 'string' } },
            clubsByLeague: {
              type: 'object',
              additionalProperties: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  }, getFc26FiltersHandler)

  app.get('/fc26-players', {
    schema: {
      tags: ['FC26 Players'],
      summary: 'Listar jogadores do dataset FC26',
      description: [
        'Filtros dentro do mesmo campo: OR. Ex.: positions=MC,ATA retorna MC **ou** ATA.',
        'Filtros entre campos diferentes: AND. Ex.: positions=MC&leagues=Premier League.',
        '`total` reflete os filtros aplicados — use para paginação.',
      ].join(' '),
      querystring: {
        type: 'object',
        properties: {
          positions:    { type: 'string', description: 'Posições separadas por vírgula', example: 'MC,ATA' },
          nations:      { type: 'string', description: 'Nacionalidades separadas por vírgula', example: 'Brazil,Argentina' },
          clubs:        { type: 'string', description: 'Clubes separados por vírgula', example: 'Real Madrid,FC Barcelona' },
          leagues:      { type: 'string', description: 'Ligas separadas por vírgula', example: 'Premier League,LaLiga EA Sports' },
          minOvr:       { type: 'integer', example: 78 },
          maxOvr:       { type: 'integer', example: 90 },
          minAge:       { type: 'integer', example: 18 },
          maxAge:       { type: 'integer', example: 26 },
          minPotential: { type: 'integer', example: 80 },
          maxPotential: { type: 'integer', example: 95 },
          limit:        { type: 'integer', default: 20, description: 'Máx: 100' },
          offset:       { type: 'integer', default: 0 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            players: { type: 'array', items: fc26PlayerSchema },
            total:   { type: 'integer' },
            limit:   { type: 'integer' },
            offset:  { type: 'integer' },
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
          sofifaId: { type: 'integer', example: 158023 },
        },
      },
      response: {
        200: fc26PlayerSchema,
        404: {
          type: 'object',
          properties: {
            error:      { type: 'string' },
            statusCode: { type: 'integer' },
          },
        },
      },
    },
  }, getFc26PlayerHandler)
}
