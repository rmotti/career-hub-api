import type { FastifyPluginAsync } from 'fastify'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { AppError } from '../shared/utils/errors.js'
import { resolveMcpContext } from './auth.js'
import { createMcpServer } from './server.js'

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
