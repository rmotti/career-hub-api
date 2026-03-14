import { FastifyInstance } from 'fastify'
import * as playersController from '../controllers/players.controller'

export async function playersRoutes(app: FastifyInstance) {
  app.get<{
    Params: { saveId: string }
    Querystring: { active?: string }
  }>('/saves/:saveId/players', {
    schema: {
      tags: ['Players'],
      summary: 'Listar jogadores',
      description: 'Sem query param: todos os jogadores com `totalStats`. Com `?active=true`: apenas elenco ativo com stats da temporada atual.',
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
      position: string
      age: number
      status: string
      ovr: number
      salary?: string
      marketValue?: string
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
          required: ['name', 'position', 'age', 'status', 'ovr'],
          properties: {
            name: { type: 'string', minLength: 1, example: 'Vinícius Jr.' },
            position: { type: 'string', enum: ['GOL', 'ZAG', 'MEI', 'ATA'] },
            age: { type: 'integer', minimum: 15, maximum: 45, example: 26 },
            status: { type: 'string', enum: ['Crucial', 'Important', 'Role', 'Sporadic', 'Promising'] },
            ovr: { type: 'integer', minimum: 40, maximum: 99, example: 91 },
            salary: { type: 'string', example: '£250,000/w' },
            marketValue: { type: 'string', example: '£120M' },
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
      position?: string
      age?: number
      status?: string
      ovr?: number
      salary?: string
      marketValue?: string
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
          properties: {
            name: { type: 'string', minLength: 1 },
            position: { type: 'string', enum: ['GOL', 'ZAG', 'MEI', 'ATA'] },
            age: { type: 'integer', minimum: 15, maximum: 45 },
            status: { type: 'string', enum: ['Crucial', 'Important', 'Role', 'Sporadic', 'Promising'] },
            ovr: { type: 'integer', minimum: 40, maximum: 99 },
            salary: { type: 'string' },
            marketValue: { type: 'string' },
          },
        },
      },
    },
    playersController.updatePlayer
  )

  app.patch<{
    Params: { saveId: string; playerId: string }
    Body: { goals?: number; assists?: number; yellowCards?: number; redCards?: number }
  }>(
    '/saves/:saveId/players/:playerId/stats',
    {
      schema: {
        tags: ['Players'],
        summary: 'Atualizar stats da temporada atual',
        description: 'Atualiza o PlayerSeasonStats da currentSeason no ClubStint atual.',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string' },
            playerId: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          properties: {
            goals: { type: 'integer', minimum: 0, example: 15 },
            assists: { type: 'integer', minimum: 0, example: 8 },
            yellowCards: { type: 'integer', minimum: 0, example: 3 },
            redCards: { type: 'integer', minimum: 0, example: 0 },
          },
        },
      },
    },
    playersController.updatePlayerStats
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
