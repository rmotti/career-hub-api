import type { FastifyPluginAsync } from 'fastify'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { AppError } from '../shared/utils/errors.js'
import { resolveMcpContext } from './auth.js'
import { createMcpServer } from './server.js'
import { checkRateLimit } from './rate-limit.js'

type McpRequestBody = { method?: string; params?: { name?: string } } | undefined

export const mcpPlugin: FastifyPluginAsync = async (app) => {
  app.post('/mcp', { schema: { hide: true } }, async (req, reply) => {
    let ctx
    try {
      ctx = await resolveMcpContext(req)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message })
      }
      throw err
    }

    const rl = await checkRateLimit(ctx.userId)
    if (!rl.ok) {
      reply.header('Retry-After', String(rl.retryAfter))
      return reply.status(429).send({ error: 'Rate limit excedido. Aguarde antes de tentar novamente.' })
    }

    const body = req.body as McpRequestBody
    const toolName = body?.method === 'tools/call' ? body.params?.name : undefined
    const start = Date.now()

    reply.raw.on('finish', () => {
      if (toolName) {
        app.log.info(
          { tool: toolName, userId: ctx.userId, durationMs: Date.now() - start, ok: reply.raw.statusCode < 400 },
          'mcp tool call',
        )
      }
    })

    const server = createMcpServer(ctx)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })

    reply.raw.on('close', () => {
      transport.close()
      server.close()
    })

    await server.connect(transport)
    await transport.handleRequest(req.raw, reply.raw, req.body)
    return reply
  })
}
