import { FastifyInstance } from 'fastify'
import { getFitScoreHealth } from '../../shared/lib/fit-score-client.js'
import { renderMetrics, METRICS_CONTENT_TYPE } from '../../shared/lib/metrics.js'

const fitScoreHealthResponse = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded', 'down', 'unknown', 'unconfigured'] },
    configured: { type: 'boolean' },
    totalCalls: { type: 'integer' },
    okCalls: { type: 'integer' },
    failedCalls: { type: 'integer' },
    consecutiveFailures: { type: 'integer' },
    lastOutcome: { type: 'string', nullable: true },
    lastFailureAt: { type: 'string', nullable: true },
    lastSuccessAt: { type: 'string', nullable: true },
    lastLatencyMs: { type: 'integer', nullable: true },
  },
}

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', {
    schema: {
      tags: ['Health'],
      summary: 'Liveness check',
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          properties: { status: { type: 'string' } },
        },
      },
    },
  }, async () => ({ status: 'ok' }))

  app.get('/health/fit-score', {
    schema: {
      tags: ['Health'],
      summary: 'Saúde do acoplamento com o serviço de fit-score',
      description: 'Sinal passivo derivado do tráfego real. Retorna 503 quando o serviço está `down` (várias falhas seguidas) para alertas/monitoração; 200 nos demais estados. O scouting continua funcionando (fit score nulo) mesmo com o serviço fora.',
      response: {
        200: fitScoreHealthResponse,
        503: fitScoreHealthResponse,
      },
    },
  }, async (_request, reply) => {
    const health = getFitScoreHealth()
    return reply.code(health.status === 'down' ? 503 : 200).send(health)
  })

  // Prometheus scrape endpoint. Optionally gated by METRICS_TOKEN (Bearer) — when the env is
  // unset the endpoint is open, which is fine for an internal-network/single-replica scrape.
  app.get('/metrics', { schema: { hide: true } }, async (request, reply) => {
    const token = process.env.METRICS_TOKEN
    if (token && request.headers.authorization !== `Bearer ${token}`) {
      return reply.code(401).send({ error: 'Unauthorized', statusCode: 401 })
    }
    return reply.header('content-type', METRICS_CONTENT_TYPE).send(renderMetrics())
  })
}
