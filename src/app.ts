import Fastify from 'fastify'
import cors from '@fastify/cors'
import compress from '@fastify/compress'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { AppError } from './shared/utils/errors.js'
import { requireAuth, requirePlan, csrfProtection } from './shared/utils/auth-hooks.js'
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
import { shortlistRoutes } from './features/shortlist/shortlist.routes.js'
import { savedSearchesRoutes } from './features/saved-searches/saved-searches.routes.js'
import { scoutingRoutes } from './features/scouting/scouting.routes.js'
import { chatRoutes } from './features/chat/chat.routes.js'
import { healthRoutes } from './features/health/health.routes.js'
import { adminRoutes } from './features/admin/admin.routes.js'
import { mcpPlugin } from './mcp/plugin.js'
import { getTrustedOrigins, isCredentialedOriginAllowed } from './shared/utils/origins.js'
import { httpRequestStarted, httpRequestFinished, recordHttpRequest } from './shared/lib/metrics.js'
import { isTransientDbError } from './shared/lib/db-retry.js'

export const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    ...(process.env.NODE_ENV === 'production' && {
      transport: undefined, // Pino JSON direto no stdout — Railway captura
    }),
  },
  trustProxy: true,
  ajv: {
    customOptions: {
      keywords: ['example'],
    },
  },
})

const trustedOrigins = getTrustedOrigins()

app.register(cors, {
  // Credentialed flow (httpOnly cookie): EXACT origin, never "*" (forbidden with credentials)
  // and no wildcard (see isCredentialedOriginAllowed).
  origin: process.env.NODE_ENV === 'production'
    ? (origin, callback) => {
        callback(null, isCredentialedOriginAllowed(origin, trustedOrigins))
      }
    : true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // Authorization (legacy Bearer) + X-CSRF-Token (double-submit of the cookie flow).
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  // Lets the SPA read the CSRF token from the response (besides the login body).
  // `set-auth-token` is NOT exposed: the cutover to the httpOnly cookie is done and the SPA
  // doesn't consume that header — exposing it would only leave the session token reachable by XSS.
  // Non-browser clients (MCP/mobile) keep using Authorization: Bearer (bearer plugin).
  exposedHeaders: ['X-CSRF-Token'],
  maxAge: 86400,
})

app.register(compress, {
  global: true,
  threshold: 1024,
  encodings: ['gzip', 'br'],
})

// Allow requests with Content-Type: application/json but no body (e.g. POST with no payload)
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  if (!body) {
    done(null, {})
    return
  }
  try {
    done(null, JSON.parse(body as string))
  } catch (err) {
    done(err as Error)
  }
})

// Metrics: count in-flight on entry, record route/status/duration on completion. Uses the
// route TEMPLATE (e.g. /api/saves/:saveId) — never the raw URL — to keep label cardinality bounded.
app.addHook('onRequest', (_request, _reply, done) => {
  httpRequestStarted()
  done()
})
app.addHook('onResponse', (request, reply, done) => {
  httpRequestFinished()
  const route = request.routeOptions?.url ?? 'unmatched'
  if (route !== '/api/metrics') {
    recordHttpRequest(request.method, route, reply.statusCode, reply.elapsedTime)
  }
  done()
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
      { name: 'Shortlist', description: 'Jogadores marcados para acompanhar dentro de um save' },
      { name: 'Saved Searches', description: 'Filtros de busca salvos por save' },
      { name: 'Scouting', description: 'Análise de elenco, busca de alvos e avaliação de contratações' },
      { name: 'Chat', description: 'Assistente tático Mister — conversa com IA sobre o save' },
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

// Health checks — public (monitoring doesn't authenticate)
app.register(healthRoutes, { prefix: '/api' })

// Public authentication routes
app.register(authRoutes, { prefix: '/api' })

// MCP — auth is resolved internally by the plugin (Bearer token)
app.register(mcpPlugin)

// Protected routes — require a valid session
app.register(async (protectedRoutes) => {
  // CSRF on onRequest (earliest phase): runs BEFORE body validation and auth, so a
  // cookie-forged write is rejected with 403 before parsing/validating the body (otherwise an
  // invalid body would return 400 and mask the 403). It only needs headers/cookies, not the body.
  // (Bearer requests and safe methods pass straight through — see csrfProtection.)
  protectedRoutes.addHook('onRequest', csrfProtection())
  protectedRoutes.addHook('preHandler', requireAuth())

  protectedRoutes.register(clubsRoutes, { prefix: '/api' })
  protectedRoutes.register(savesRoutes, { prefix: '/api' })
  protectedRoutes.register(clubStintsRoutes, { prefix: '/api' })
  protectedRoutes.register(playersRoutes, { prefix: '/api' })
  protectedRoutes.register(teamStatsRoutes, { prefix: '/api' })
  protectedRoutes.register(transfersRoutes, { prefix: '/api' })
  protectedRoutes.register(trophiesRoutes, { prefix: '/api' })
  protectedRoutes.register(competitionsRoutes, { prefix: '/api' })

  // Admin surface — gated by requireRole('admin') inside the plugin (no plan check needed).
  protectedRoutes.register(adminRoutes, { prefix: '/api' })

  // PRO surface — requires a PRO+ plan (admin always passes). Without this the paywall is frontend-only.
  protectedRoutes.register(async (proRoutes) => {
    proRoutes.addHook('preHandler', requirePlan('PRO'))

    proRoutes.register(fc26PlayersRoutes, { prefix: '/api' })
    proRoutes.register(scoutPlaybooksRoutes, { prefix: '/api' })
    proRoutes.register(shortlistRoutes, { prefix: '/api' })
    proRoutes.register(savedSearchesRoutes, { prefix: '/api' })
    proRoutes.register(scoutingRoutes, { prefix: '/api' })
    proRoutes.register(chatRoutes, { prefix: '/api' })
  })
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

  // Transient infra blip (DB unreachable, connection dropped, pool timeout) — a typed,
  // retryable 503 instead of a raw 500. Writes are not queued, so the client retries (#15).
  if (isTransientDbError(error)) {
    app.log.warn({ err: error }, 'Transient database error')
    return reply
      .header('Retry-After', '1')
      .status(503)
      .send({
        error: 'SERVICE_UNAVAILABLE',
        message: 'Banco de dados temporariamente indisponível. Tente novamente em instantes.',
        statusCode: 503,
      })
  }

  if (error.statusCode && error.statusCode < 500) {
    return reply.status(error.statusCode).send({
      error: error.message,
      statusCode: error.statusCode,
    })
  }

  app.log.error({ err: error }, 'Unhandled error')
  console.error('[500]', error)
  return reply.status(500).send({
    error: 'Erro interno do servidor.',
    statusCode: 500,
  })
})
