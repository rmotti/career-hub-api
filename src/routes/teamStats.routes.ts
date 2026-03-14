import { FastifyInstance } from 'fastify'
import * as teamStatsController from '../controllers/teamStats.controller'

const CUP_RESULT_VALUES = ['Campeao', 'Final', 'Semifinal', 'Quartas', 'OitavasOuFaseDeGrupos', 'Eliminado', 'NaoParticipou'] as const

export async function teamStatsRoutes(app: FastifyInstance) {
  app.get<{
    Params: { saveId: string }
    Querystring: { season?: string }
  }>('/saves/:saveId/team-stats', {
    schema: {
      tags: ['Team Stats'],
      summary: 'Listar estatísticas da equipe',
      description: 'Com `?season=current`: retorna apenas os stats da temporada atual. Sem query param: retorna todos os stats de todos os clubes.',
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
  }, teamStatsController.listTeamStats)

  app.patch<{
    Params: { saveId: string; statsId: string }
    Body: {
      goalsPro?: number
      goalsAgainst?: number
      possession?: number
      wins?: number
      draws?: number
      losses?: number
      leaguePosition?: number
      europeanCupResult?: typeof CUP_RESULT_VALUES[number]
      nationalCupResult?: typeof CUP_RESULT_VALUES[number]
    }
  }>(
    '/saves/:saveId/team-stats/:statsId',
    {
      schema: {
        tags: ['Team Stats'],
        summary: 'Atualizar estatísticas da equipe',
        description: '`possession` deve estar entre 0 e 100.',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string' },
            statsId: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          properties: {
            goalsPro: { type: 'integer', minimum: 0, example: 55 },
            goalsAgainst: { type: 'integer', minimum: 0, example: 22 },
            possession: { type: 'integer', minimum: 0, maximum: 100, example: 57 },
            wins: { type: 'integer', minimum: 0, example: 24 },
            draws: { type: 'integer', minimum: 0, example: 5 },
            losses: { type: 'integer', minimum: 0, example: 9 },
            leaguePosition: { type: 'integer', minimum: 1, example: 1 },
            europeanCupResult: { type: 'string', enum: [...CUP_RESULT_VALUES], example: 'Campeao' },
            nationalCupResult: { type: 'string', enum: [...CUP_RESULT_VALUES], example: 'Semifinal' },
          },
        },
      },
    },
    teamStatsController.updateTeamStats
  )
}
