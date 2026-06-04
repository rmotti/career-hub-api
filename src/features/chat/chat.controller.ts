import { FastifyRequest, FastifyReply } from 'fastify'
import { AppError } from '../../shared/utils/errors.js'
import { mintMcpToken } from '../../mcp/auth.js'
import { checkChatRateLimit } from './chat.rate-limit.js'
import * as chatService from './chat.service.js'

type SendMessageBody = {
  message: string
  previousResponseId?: string
}

export async function sendMessage(
  request: FastifyRequest<{ Body: SendMessageBody }>,
  reply: FastifyReply,
) {
  const rl = await checkChatRateLimit(request.user!.id)
  if (!rl.ok) {
    reply.header('Retry-After', String(rl.retryAfter))
    throw new AppError('Rate limit excedido. Aguarde antes de tentar novamente.', 429)
  }

  const { message, previousResponseId } = request.body
  // Token efêmero com escopo MCP em vez do token de sessão completo: o token que
  // transita pela OpenAI só dá acesso read-only ao MCP daquele usuário, por ~10 min.
  const mcpToken = await mintMcpToken(request.user!.id)
  const mcpBaseUrl = process.env.API_URL ?? `${request.protocol}://${request.hostname}`

  const result = await chatService.sendMessage({ message, mcpToken, previousResponseId, mcpBaseUrl })
  return reply.send(result)
}
