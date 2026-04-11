import Fastify from 'fastify'
import cors from '@fastify/cors'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { AppError } from './shared/utils/errors'
import { clubsRoutes } from './features/clubs/clubs.routes'
import { savesRoutes } from './features/saves/saves.routes'
import { clubStintsRoutes } from './features/club-stints/club-stints.routes'
import { playersRoutes } from './features/players/players.routes'
import { teamStatsRoutes } from './features/team-stats/team-stats.routes'
import { transfersRoutes } from './features/transfers/transfers.routes'
import { trophiesRoutes } from './features/trophies/trophies.routes'

export const app = Fastify({
  logger: process.env.NODE_ENV !== 'production',
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

app.get('/', (_request, reply) => {
  reply.redirect('/docs')
})

app.register(clubsRoutes, { prefix: '/api' })
app.register(savesRoutes, { prefix: '/api' })
app.register(clubStintsRoutes, { prefix: '/api' })
app.register(playersRoutes, { prefix: '/api' })
app.register(teamStatsRoutes, { prefix: '/api' })
app.register(transfersRoutes, { prefix: '/api' })
app.register(trophiesRoutes, { prefix: '/api' })

app.setSchemaErrorFormatter((errors, _dataVar) => {
  const first = errors[0]
  const field = first.instancePath.replace('/', '') || (first.params as Record<string, string>)?.missingProperty
  return new Error(`Campo inválido: '${field}' — ${first.message}`)
})

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof AppError) {
    if (error.code) {
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
        statusCode: error.statusCode,
      })
    }
    return reply.status(error.statusCode).send({
      error: error.message,
      statusCode: error.statusCode,
    })
  }

  if (error instanceof PrismaClientKnownRequestError) {
    if (error.code === 'P2025') {
      return reply.status(404).send({ error: 'Registro não encontrado.', statusCode: 404 })
    }
    if (error.code === 'P2003') {
      return reply.status(400).send({ error: 'Referência inválida: um dos IDs fornecidos não existe.', statusCode: 400 })
    }
    if (error.code === 'P2002') {
      return reply.status(409).send({ error: 'Conflito: registro duplicado.', statusCode: 409 })
    }
  }

  if (error.validation) {
    return reply.status(400).send({
      error: error.message,
      statusCode: 400,
    })
  }

  app.log.error(error)
  return reply.status(500).send({
    error: 'Erro interno do servidor.',
    statusCode: 500,
  })
})
