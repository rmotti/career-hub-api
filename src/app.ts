import Fastify from 'fastify'
import cors from '@fastify/cors'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { AppError } from './utils/errors'
import { clubsRoutes } from './routes/clubs.routes'
import { savesRoutes } from './routes/saves.routes'
import { clubStintsRoutes } from './routes/clubStints.routes'
import { playersRoutes } from './routes/players.routes'
import { teamStatsRoutes } from './routes/teamStats.routes'
import { transfersRoutes } from './routes/transfers.routes'
import { trophiesRoutes } from './routes/trophies.routes'

export const app = Fastify({
  logger: true,
  ajv: {
    customOptions: {
      keywords: ['example'],
    },
  },
})

app.register(cors, { origin: '*' })

app.register(swagger, {
  openapi: {
    info: {
      title: 'FC 26 Career Mode Hub API',
      description: 'API para tracking de Career Mode do FC 26 — clubes, elenco, estatísticas, transferências e troféus.',
      version: '1.0.0',
    },
    tags: [
      { name: 'Clubs', description: 'Lista de clubes disponíveis' },
      { name: 'Saves', description: 'Gerenciamento de saves/carreiras' },
      { name: 'Club Stints', description: 'Passagens por clubes dentro de um save' },
      { name: 'Players', description: 'Jogadores do elenco' },
      { name: 'Team Stats', description: 'Estatísticas da equipe por temporada' },
      { name: 'Transfers', description: 'Transferências de jogadores' },
      { name: 'Trophies', description: 'Troféus conquistados' },
    ],
  },
})

app.register(swaggerUi, {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: true,
  },
})

app.register(clubsRoutes, { prefix: '/api' })
app.register(savesRoutes, { prefix: '/api' })
app.register(clubStintsRoutes, { prefix: '/api' })
app.register(playersRoutes, { prefix: '/api' })
app.register(teamStatsRoutes, { prefix: '/api' })
app.register(transfersRoutes, { prefix: '/api' })
app.register(trophiesRoutes, { prefix: '/api' })

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: error.message,
      statusCode: error.statusCode,
    })
  }

  if (error.validation) {
    return reply.status(400).send({
      error: error.message,
      statusCode: 400,
    })
  }

  app.log.error(error)
  return reply.status(500).send({
    error: 'Internal Server Error',
    statusCode: 500,
  })
})
