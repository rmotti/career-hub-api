import { FastifyInstance } from 'fastify'
import * as teamStatsController from './team-stats.controller.js'

const CUP_RESULT_VALUES = ['Campeao', 'Final', 'Semifinal', 'Quartas', 'OitavasOuFaseDeGrupos', 'Eliminado', 'NaoParticipou'] as const

export async function teamStatsRoutes(app: FastifyInstance) {
  app.get<{
    Params: { saveId: string }
    Querystring: { season?: string }
  }>('/saves/:saveId/team-stats', {
    schema: {
      tags: ['Team Stats'],
      summary: 'Listar estatísticas da equipe',
      description: 'Retorna estatísticas por competição. Com `?season=current`: temporada atual. Sem filtro: todas as temporadas de todos os clubes.',
      params: {
        type: 'object',
        properties: {
          saveId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          season: { type: 'string', description: 'Use "current" para a temporada atual, ou "2027/28" para uma específica' },
        },
      },
    },
  }, teamStatsController.listTeamStats)

  app.patch<{
    Params: { saveId: string; statsId: string }
    Body: {
      goalsPro?: number
      goalsAgainst?: number
      wins?: number
      draws?: number
      losses?: number
      leaguePosition?: number
      cupResult?: typeof CUP_RESULT_VALUES[number]
    }
  }>(
    '/saves/:saveId/team-stats/:statsId',
    {
      schema: {
        tags: ['Team Stats'],
        summary: 'Atualizar estatísticas da equipe',
        description: 'Atualiza stats de uma competição específica. Para copas/europeia use `cupResult`. Para liga use `leaguePosition`.',
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
            goalsPro:      { type: 'integer', minimum: 0, example: 55 },
            goalsAgainst:  { type: 'integer', minimum: 0, example: 22 },
            wins:          { type: 'integer', minimum: 0, example: 24 },
            draws:         { type: 'integer', minimum: 0, example: 5  },
            losses:        { type: 'integer', minimum: 0, example: 9  },
            leaguePosition: { type: 'integer', minimum: 1, example: 1 },
            cupResult:     { type: 'string', enum: [...CUP_RESULT_VALUES], example: 'Campeao' },
          },
        },
      },
    },
    teamStatsController.updateTeamStats
  )
}
