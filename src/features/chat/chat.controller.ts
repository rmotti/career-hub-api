import { FastifyRequest, FastifyReply } from 'fastify'
import { AppError } from '../../shared/utils/errors.js'
import { mintMcpToken } from '../../mcp/auth.js'
import { checkChatRateLimit } from './chat.rate-limit.js'
import * as chatService from './chat.service.js'
import * as conversationsService from './conversations.service.js'

type SendMessageBody = {
  message: string
  previousResponseId?: string
  conversationId?: string
}

type CreateConversationBody = {
  title?: string
  saveId?: string
}

type ConversationParams = { conversationId: string }

export async function sendMessage(
  request: FastifyRequest<{ Body: SendMessageBody }>,
  reply: FastifyReply,
) {
  const rl = await checkChatRateLimit(request.user!.id)
  if (!rl.ok) {
    reply.header('Retry-After', String(rl.retryAfter))
    throw new AppError('Rate limit exceeded. Please wait before trying again.', 429)
  }

  const { message, previousResponseId, conversationId } = request.body
  const mcpToken = await mintMcpToken(request.user!.id)
  const mcpBaseUrl = process.env.API_URL ?? `${request.protocol}://${request.hostname}`

  let resolvedPreviousResponseId = previousResponseId
  if (conversationId) {
    await conversationsService.assertConversationAccess(conversationId, request.user!.id)
    resolvedPreviousResponseId =
      (await conversationsService.getLastOpenaiResponseId(conversationId)) ?? undefined
  }

  const result = await chatService.sendMessage({
    message,
    mcpToken,
    mcpBaseUrl,
    previousResponseId: resolvedPreviousResponseId,
  })

  if (conversationId) {
    await conversationsService.persistTurn(conversationId, message, result.reply, result.responseId)
  }

  return reply.send(result)
}

export async function createConversation(
  request: FastifyRequest<{ Body: CreateConversationBody }>,
  reply: FastifyReply,
) {
  const conv = await conversationsService.createConversation(request.user!.id, request.body)
  return reply.status(201).send(conv)
}

export async function listConversations(
  request: FastifyRequest<{ Querystring: { saveId?: string } }>,
  reply: FastifyReply,
) {
  const conversations = await conversationsService.listConversations(request.user!.id, {
    saveId: request.query.saveId,
  })
  return reply.send(conversations)
}

export async function deleteConversation(
  request: FastifyRequest<{ Params: ConversationParams }>,
  reply: FastifyReply,
) {
  await conversationsService.deleteConversation(request.params.conversationId, request.user!.id)
  return reply.status(204).send()
}

export async function getMessages(
  request: FastifyRequest<{ Params: ConversationParams }>,
  reply: FastifyReply,
) {
  const messages = await conversationsService.getMessages(
    request.params.conversationId,
    request.user!.id,
  )
  return reply.send(messages)
}
