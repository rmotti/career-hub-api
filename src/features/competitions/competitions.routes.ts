import { FastifyInstance } from 'fastify'
import * as competitionsController from './competitions.controller.js'

export async function competitionsRoutes(app: FastifyInstance) {
  app.get('/competitions', {
    schema: {
      tags: ['Competitions'],
      summary: 'Listar todas as competições',
      description: 'Retorna as 19 competições fixas registradas no sistema.',
    },
  }, competitionsController.listCompetitions)

  app.get('/competitions/european', {
    schema: {
      tags: ['Competitions'],
      summary: 'Listar competições europeias',
      description: 'Retorna UEFA Champions League, Europa League e Conference League — usado para o dropdown de virada de temporada.',
    },
  }, competitionsController.listEuropeanCompetitions)
}
