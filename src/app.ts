import Fastify from 'fastify'
import cors from '@fastify/cors'
import compress from '@fastify/compress'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { AppError } from './shared/utils/errors.js'
import { requireAuth } from './shared/utils/auth-hooks.js'
import { authRoutes } from './features/auth/auth.routes.js'
import { clubsRoutes } from './features/clubs/clubs.routes.js'
import { savesRoutes } from './features/saves/saves.routes.js'
import { clubStintsRoutes } from './features/club-stints/club-stints.routes.js'
import { playersRoutes } from './features/players/players.routes.js'
import { teamStatsRoutes } from './features/team-stats/team-stats.routes.js'
import { transfersRoutes } from './features/transfers/transfers.routes.js'
import { trophiesRoutes } from './features/trophies/trophies.routes.js'
import { competitionsRoutes } from './features/competitions/competitions.routes.js'
import { fc26PlayersRoutes } from './features/fc26-players/fc26-players.routes.js'
import { scoutPlaybooksRoutes } from './features/scout-playbooks/scout-playbooks.routes.js'
import { getTrustedOrigins, isTrustedOrigin } from './shared/utils/origins.js'

export const app = Fastify({
  logger: process.env.NODE_ENV !== 'production',
  ajv: {
    customOptions: {
      keywords: ['example'],
    },
  },
})

const trustedOrigins = getTrustedOrigins()

app.register(cors, {
  origin: process.env.NODE_ENV === 'production'
    ? (origin, callback) => {
        callback(null, isTrustedOrigin(origin, trustedOrigins))
      }
    : true,
  credentials: true,
})

app.register(compress, {
  global: true,
  threshold: 1024,
  encodings: ['gzip', 'br'],
})

app.register(swagger, {
  openapi: {
    info: {
      title: 'FC 26 Career Mode Hub API',
      description: 'API para tracking de Career Mode do FC 26 — clubes, elenco, estatísticas, transferências e troféus.',
      version: '1.0.0',
    },
    tags: [
      { name: 'Auth', description: 'Autenticação e sessão' },
      { name: 'Clubs', description: 'Lista de clubes disponíveis' },
      { name: 'Saves', description: 'Gerenciamento de saves/carreiras' },
      { name: 'Club Stints', description: 'Passagens por clubes dentro de um save' },
      { name: 'Players', description: 'Jogadores do elenco' },
      { name: 'Team Stats', description: 'Estatísticas da equipe por temporada' },
      { name: 'Transfers', description: 'Transferências de jogadores' },
      { name: 'Trophies', description: 'Troféus conquistados' },
      { name: 'Competitions', description: 'Competições disponíveis (liga, copa, europeia)' },
      { name: 'FC26 Players', description: 'Dataset de jogadores do FC26 — usado pelo módulo Scout' },
      { name: 'Scout Playbooks', description: 'Playbooks configuráveis para calcular scout score' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Token de sessão retornado pelo login. Passe no header: Authorization: Bearer <token>',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
})

app.register(swaggerUi, {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: true,
  },
})

app.get('/', { schema: { hide: true } }, (_request, reply) => {
  reply.redirect('/docs')
})

// Rotas públicas de autenticação
app.register(authRoutes, { prefix: '/api' })

// Rotas protegidas — requerem sessão válida
app.register(async (protectedRoutes) => {
  protectedRoutes.addHook('preHandler', requireAuth())

  protectedRoutes.register(clubsRoutes, { prefix: '/api' })
  protectedRoutes.register(savesRoutes, { prefix: '/api' })
  protectedRoutes.register(clubStintsRoutes, { prefix: '/api' })
  protectedRoutes.register(playersRoutes, { prefix: '/api' })
  protectedRoutes.register(teamStatsRoutes, { prefix: '/api' })
  protectedRoutes.register(transfersRoutes, { prefix: '/api' })
  protectedRoutes.register(trophiesRoutes, { prefix: '/api' })
  protectedRoutes.register(competitionsRoutes, { prefix: '/api' })
  protectedRoutes.register(fc26PlayersRoutes, { prefix: '/api' })
  protectedRoutes.register(scoutPlaybooksRoutes, { prefix: '/api' })
})

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
