import { FastifyInstance } from 'fastify'
import {
  listFc26PlayersHandler,
  getFc26PlayerHandler,
  getFc26FiltersHandler,
} from './fc26-players.controller.js'

const nullableInt = { type: 'integer', nullable: true }
const nullableNum = { type: 'number', nullable: true }
const nullableStr = { type: 'string', nullable: true }

const fc26PlayerSchema = {
  type: 'object',
  properties: {
    fitScore: { type: 'number', nullable: true },
    fitConfidence: { type: 'string', nullable: true },
    id: { type: 'integer' },
    sofifaId: { type: 'integer' },
    name: { type: 'string' },
    longName: nullableStr,
    positions: { type: 'array', items: { type: 'string' } },
    age: { type: 'integer' },
    dob: nullableStr,
    height: nullableInt,
    weight: nullableInt,
    ovr: { type: 'integer' },
    potential: { type: 'integer' },
    marketValue: nullableNum,
    nation: nullableStr,
    club: nullableStr,
    league: nullableStr,
    wage: nullableNum,
    playerFaceUrl: nullableStr,

    contractUntil: nullableInt,
    releaseClause: nullableNum,

    preferredFoot: nullableStr,
    weakFoot: nullableInt,
    skillMoves: nullableInt,
    internationalReputation: nullableInt,
    workRate: nullableStr,
    bodyType: nullableStr,
    playerTags: { type: 'array', items: { type: 'string' } },
    playerTraits: { type: 'array', items: { type: 'string' } },

    pace: nullableInt,
    shooting: nullableInt,
    passing: nullableInt,
    dribbling: nullableInt,
    defending: nullableInt,
    physic: nullableInt,

    attackingCrossing: nullableInt,
    attackingFinishing: nullableInt,
    attackingHeadingAccuracy: nullableInt,
    attackingShortPassing: nullableInt,
    attackingVolleys: nullableInt,

    skillDribbling: nullableInt,
    skillCurve: nullableInt,
    skillFkAccuracy: nullableInt,
    skillLongPassing: nullableInt,
    skillBallControl: nullableInt,

    movementAcceleration: nullableInt,
    movementSprintSpeed: nullableInt,
    movementAgility: nullableInt,
    movementReactions: nullableInt,
    movementBalance: nullableInt,

    powerShotPower: nullableInt,
    powerJumping: nullableInt,
    powerStamina: nullableInt,
    powerStrength: nullableInt,
    powerLongShots: nullableInt,

    mentalityAggression: nullableInt,
    mentalityInterceptions: nullableInt,
    mentalityPositioning: nullableInt,
    mentalityVision: nullableInt,
    mentalityPenalties: nullableInt,
    mentalityComposure: nullableInt,

    defendingMarkingAwareness: nullableInt,
    defendingStandingTackle: nullableInt,
    defendingSlidingTackle: nullableInt,

    goalkeepingDiving: nullableInt,
    goalkeepingHandling: nullableInt,
    goalkeepingKicking: nullableInt,
    goalkeepingPositioning: nullableInt,
    goalkeepingReflexes: nullableInt,
    goalkeepingSpeed: nullableInt,
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
          positions:          { type: 'string', description: 'Posições separadas por vírgula (qualquer posição do array)', example: 'MC,ATA' },
          primaryPositions:   { type: 'string', description: 'Filtro por posição principal (positions[0]), separadas por vírgula', example: 'ATA,ZAG' },
          secondaryPositions: { type: 'string', description: 'Filtro por posição secundária (positions[1..]), separadas por vírgula', example: 'PD,PE' },
          nations:      { type: 'string', description: 'Nacionalidades separadas por vírgula', example: 'Brazil,Argentina' },
          clubs:        { type: 'string', description: 'Clubes separados por vírgula', example: 'Real Madrid,FC Barcelona' },
          leagues:      { type: 'string', description: 'Ligas separadas por vírgula', example: 'Premier League,LaLiga EA Sports' },
          minOvr:       { type: 'integer', example: 78 },
          maxOvr:       { type: 'integer', example: 90 },
          minAge:       { type: 'integer', example: 18 },
          maxAge:       { type: 'integer', example: 26 },
          minPotential: { type: 'integer', example: 80 },
          maxPotential: { type: 'integer', example: 95 },
          minMarketValue: { type: 'number', example: 100, description: 'Valor de mercado mínimo em milhões de €' },
          maxMarketValue: { type: 'number', example: 250, description: 'Valor de mercado máximo em milhões de €' },
          minPace:      { type: 'integer', example: 85, description: 'Pace mínimo' },
          maxPace:      { type: 'integer', example: 99, description: 'Pace máximo' },
          minHeight:    { type: 'integer', example: 180, description: 'Altura mínima em cm' },
          maxHeight:    { type: 'integer', example: 200, description: 'Altura máxima em cm' },
          preferredFoot: { type: 'string', enum: ['Left', 'Right'], description: 'Pé dominante' },
          traits:       { type: 'string', description: 'Traits separados por vírgula', example: 'Power Shot,Rapid' },
          limit:        { type: 'integer', default: 20, description: 'Máx: 100' },
          offset:       { type: 'integer', default: 0 },
          saveId:    { type: 'string', description: 'ID do save — quando fornecido, calcula o fit score de cada jogador para o clube atual' },
          objective: { type: 'string', default: 'balanced', description: 'Objetivo do clube para o modelo de fit score (ex: balanced, attack, title)' },
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
