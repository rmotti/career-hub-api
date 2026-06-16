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
import { mcpPlugin } from './mcp/plugin.js'
import { getTrustedOrigins, isCredentialedOriginAllowed } from './shared/utils/origins.js'

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
  // Fluxo credenciado (cookie httpOnly): origin EXATO, nunca "*" (proibido com credentials)
  // e sem wildcard (ver isCredentialedOriginAllowed).
  origin: process.env.NODE_ENV === 'production'
    ? (origin, callback) => {
        callback(null, isCredentialedOriginAllowed(origin, trustedOrigins))
      }
    : true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // Authorization (Bearer legado) + X-CSRF-Token (double-submit do fluxo por cookie).
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  // Permite o SPA ler o token CSRF da resposta (além do corpo do login).
  // `set-auth-token` NÃO é exposto: o cutover para cookie httpOnly está concluído e o SPA
  // não consome esse header — expô-lo só deixaria o token de sessão alcançável por XSS.
  // Clientes não-browser (MCP/mobile) continuam usando Authorization: Bearer (bearer plugin).
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

// Rotas públicas de autenticação
app.register(authRoutes, { prefix: '/api' })

// MCP — auth é resolvida internamente pelo plugin (Bearer token)
app.register(mcpPlugin)

// Rotas protegidas — requerem sessão válida
app.register(async (protectedRoutes) => {
  // CSRF no onRequest (fase mais cedo): roda ANTES da validação de body e do auth, então uma
  // escrita forjada por cookie é rejeitada com 403 antes de parsear/validar o corpo (senão um
  // body inválido retornaria 400 e mascararia o 403). Só precisa de headers/cookies, não do body.
  // (Requisições por Bearer e métodos seguros passam direto — ver csrfProtection.)
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

  // Superfície PRO — exige plano PRO+ (admin sempre passa). Sem isto o paywall é só no frontend.
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
