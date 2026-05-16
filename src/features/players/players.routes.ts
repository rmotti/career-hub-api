import { FastifyInstance } from 'fastify'
import { Position, PlayerStatus } from '@prisma/client'
import * as playersController from './players.controller.js'

const POSITION_VALUES = ['GOL', 'LD', 'LE', 'ZAG', 'VOL', 'MC', 'ME', 'MD', 'MEI', 'PE', 'PD', 'SA', 'ATA'] as const

const alternativePositionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['positions'],
  properties: {
    positions: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', enum: POSITION_VALUES },
      example: ['PD', 'SA'],
    },
  },
}

export async function playersRoutes(app: FastifyInstance) {
  app.get<{
    Params: { saveId: string }
    Querystring: { active?: string; season?: string; loaned?: string }
  }>('/saves/:saveId/players', {
    schema: {
      tags: ['Players'],
      summary: 'Listar jogadores',
      description: 'Sem query param: todos os jogadores com `totalStats`. Com `?active=true`: elenco ativo com stats da temporada atual + `ovrDelta`. Com `?active=true&season=2027/28`: elenco ativo naquela temporada. Com `?loaned=true`: jogadores emprestados pelo clube atual, com `loanedTo` e `loanSeason`.',
      params: {
        type: 'object',
        properties: {
          saveId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          active: { type: 'string', enum: ['true'], description: 'Filtrar apenas jogadores ativos no clube atual' },
          season: { type: 'string', description: 'Temporada específica (ex: 2027/28). Padrão: temporada atual.' },
          loaned: { type: 'string', enum: ['true'], description: 'Listar jogadores emprestados pelo clube atual' },
        },
      },
    },
  }, playersController.listPlayers)

  app.get<{ Params: { saveId: string; playerId: string } }>(
    '/saves/:saveId/players/:playerId',
    {
      schema: {
        tags: ['Players'],
        summary: 'Buscar jogador por ID',
        description: 'Retorna o jogador com `totalStats` e `history` de todas as temporadas com nome do clube.',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string' },
            playerId: { type: 'string' },
          },
        },
      },
    },
    playersController.getPlayer
  )

  app.post<{
    Params: { saveId: string }
    Body: {
      name: string
      position: Position
      age: number
      status: PlayerStatus
      ovr: number
      alternativePosition?: { positions: Position[] }
      salary?: number
      marketValue?: number
    }
  }>(
    '/saves/:saveId/players',
    {
      schema: {
        tags: ['Players'],
        summary: 'Adicionar jogador ao elenco',
        description: 'Cria o jogador, vincula ao ClubStint atual e cria PlayerSeasonStats para a temporada corrente.',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'position', 'age', 'status', 'ovr'],
          properties: {
            name: { type: 'string', minLength: 1, example: 'Vinícius Jr.' },
            position: { type: 'string', enum: ['GOL', 'LD', 'LE', 'ZAG', 'VOL', 'MC', 'ME', 'MD', 'MEI', 'PE', 'PD', 'SA', 'ATA'] },
            age: { type: 'integer', minimum: 15, maximum: 45, example: 26 },
            status: { type: 'string', enum: ['Crucial', 'Important', 'Role', 'Sporadic', 'Promising'] },
            ovr: { type: 'integer', minimum: 40, maximum: 99, example: 91 },
            potential: { type: 'integer', minimum: 40, maximum: 99, example: 88 },
            shirtNumber: { type: 'integer', minimum: 1, maximum: 99, example: 10 },
            nation: { type: 'string', example: 'Brasil' },
            alternativePosition: alternativePositionSchema,
            salary: { type: 'number', minimum: 0, example: 75, description: 'Em milhares de €: 75 = €75K' },
            marketValue: { type: 'number', minimum: 0, example: 35, description: 'Em milhões de €: 35 = €35M, 0.9 = €900K' },
            matches: { type: 'integer', minimum: 0, example: 23 },
          },
        },
      },
    },
    playersController.createPlayer
  )

  app.put<{
    Params: { saveId: string; playerId: string }
    Body: {
      name?: string
      position?: Position
      age?: number
      status?: PlayerStatus
      ovr?: number
      alternativePosition?: { positions: Position[] }
      salary?: number
      marketValue?: number
    }
  }>(
    '/saves/:saveId/players/:playerId',
    {
      schema: {
        tags: ['Players'],
        summary: 'Atualizar jogador',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string' },
            playerId: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1 },
            position: { type: 'string', enum: ['GOL', 'LD', 'LE', 'ZAG', 'VOL', 'MC', 'ME', 'MD', 'MEI', 'PE', 'PD', 'SA', 'ATA'] },
            age: { type: 'integer', minimum: 15, maximum: 45 },
            status: { type: 'string', enum: ['Crucial', 'Important', 'Role', 'Sporadic', 'Promising'] },
            ovr: { type: 'integer', minimum: 40, maximum: 99 },
            potential: { type: 'integer', minimum: 40, maximum: 99 },
            shirtNumber: { type: 'integer', minimum: 1, maximum: 99 },
            nation: { type: 'string' },
            alternativePosition: alternativePositionSchema,
            salary: { type: 'number', minimum: 0, description: 'Em milhares de €: 75 = €75K' },
            marketValue: { type: 'number', minimum: 0, description: 'Em milhões de €: 35 = €35M, 0.9 = €900K' },
            matches: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    playersController.updatePlayer
  )

  app.patch<{
    Params: { saveId: string; playerId: string }
    Body: { goals?: number; assists?: number; matches?: number; yellowCards?: number; redCards?: number }
  }>(
    '/saves/:saveId/players/:playerId/stats',
    {
      schema: {
        tags: ['Players'],
        summary: 'Atualizar stats da temporada atual',
        description: 'Atualiza o PlayerSeasonStats da currentSeason no ClubStint atual. `goalContributions` é calculado automaticamente e não deve ser enviado.',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string' },
            playerId: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            goals: { type: 'integer', minimum: 0, example: 15 },
            assists: { type: 'integer', minimum: 0, example: 8 },
            matches: { type: 'integer', minimum: 0, example: 28 },
            yellowCards: { type: 'integer', minimum: 0, example: 3 },
            redCards: { type: 'integer', minimum: 0, example: 0 },
            cleanSheets: { type: 'integer', minimum: 0, example: 12 },
          },
        },
      },
    },
    playersController.updatePlayerStats
  )

  app.post<{ Params: { saveId: string } }>(
    '/saves/:saveId/players/import-fc26',
    {
      schema: {
        tags: ['Players'],
        summary: 'Importar elenco do dataset FC26',
        description: 'Busca todos os jogadores do dataset FC26 cujo `club` bate com o clube atual do save e cria um Player + PlayerSeasonStats (zerado) para cada um. Jogadores cujo nome já existe no save são pulados. Status default: `Important`. Posições inválidas no dataset são ignoradas. Retorna `{ imported, skipped, total }`.',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string' },
          },
        },
      },
    },
    playersController.importFc26Squad
  )

  app.delete<{ Params: { saveId: string; playerId: string } }>(
    '/saves/:saveId/players/:playerId/release',
    {
      schema: {
        tags: ['Players'],
        summary: 'Dispensar jogador',
        description: 'Seta `activeClubStintId: null` — jogador permanece no save mas sai do elenco ativo.',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string' },
            playerId: { type: 'string' },
          },
        },
      },
    },
    playersController.releasePlayer
  )
}
