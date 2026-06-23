import { FastifyRequest, FastifyReply } from 'fastify'
import { AppError } from '../../shared/utils/errors.js'
import { mintMcpToken } from '../../mcp/auth.js'
import { getSaveDossierJson } from '../saves/dossier.service.js'
import { checkChatRateLimit } from './chat.rate-limit.js'
import { getSaveSuggestions } from './suggestions.service.js'
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

/**
 * Shared setup for a chat turn (streaming and non-streaming): resolves the conversation chain,
 * pins the MCP token to the conversation's save, and prepares the first-turn dossier injection.
 * Runs before any SSE hijack so its errors still produce normal JSON responses.
 */
async function prepareTurn(request: FastifyRequest<{ Body: SendMessageBody }>) {
  const { previousResponseId, conversationId } = request.body
  const mcpBaseUrl = process.env.API_URL ?? `${request.protocol}://${request.hostname}`

  let resolvedPreviousResponseId = previousResponseId
  let boundSaveId: string | undefined
  if (conversationId) {
    await conversationsService.assertConversationAccess(conversationId, request.user!.id)
    resolvedPreviousResponseId =
      (await conversationsService.getLastOpenaiResponseId(conversationId)) ?? undefined
    boundSaveId = (await conversationsService.getConversationSaveId(conversationId)) ?? undefined
  }

  // Pin the MCP token to the conversation's save so tools answer about the right save.
  const mcpToken = await mintMcpToken(request.user!.id, boundSaveId)

  // First turn of a save-pinned conversation: auto-attach the dossier so the (small) model is
  // grounded from message 1. Skipped on follow-ups — it already lives in the response chain.
  let dossierJson: string | undefined
  if (boundSaveId && !resolvedPreviousResponseId) {
    dossierJson = (await getSaveDossierJson(request.user!.id, boundSaveId)) ?? undefined
  }

  return { mcpBaseUrl, mcpToken, resolvedPreviousResponseId, boundSaveId, dossierJson }
}

async function suggestionsFor(userId: string, boundSaveId?: string): Promise<string[]> {
  if (!boundSaveId) return []
  return getSaveSuggestions(userId, boundSaveId).catch(() => [])
}

export async function sendMessage(
  request: FastifyRequest<{ Body: SendMessageBody }>,
  reply: FastifyReply,
) {
  const rl = await checkChatRateLimit(request.user!.id)
  if (!rl.ok) {
    reply.header('Retry-After', String(rl.retryAfter))
    throw new AppError('Rate limit exceeded. Please wait before trying again.', 429)
  }

  const { message, conversationId } = request.body
  const ctx = await prepareTurn(request)

  const result = await chatService.sendMessage({
    message,
    mcpToken: ctx.mcpToken,
    mcpBaseUrl: ctx.mcpBaseUrl,
    previousResponseId: ctx.resolvedPreviousResponseId,
    dossierJson: ctx.dossierJson,
  })

  if (conversationId) {
    await conversationsService.persistTurn(conversationId, message, result.reply, result.responseId)
  }

  const suggestions = await suggestionsFor(request.user!.id, ctx.boundSaveId)
  return reply.send({ ...result, suggestions })
}

/**
 * Streaming variant of `sendMessage` over Server-Sent Events. Additive — the non-streaming
 * `POST /chat/messages` is unchanged. Events: `delta` ({ delta }), `done` ({ responseId,
 * suggestions }), `error` ({ message }).
 */
export async function sendMessageStream(
  request: FastifyRequest<{ Body: SendMessageBody }>,
  reply: FastifyReply,
) {
  const rl = await checkChatRateLimit(request.user!.id)
  if (!rl.ok) {
    reply.header('Retry-After', String(rl.retryAfter))
    throw new AppError('Rate limit exceeded. Please wait before trying again.', 429)
  }

  const { message, conversationId } = request.body
  const ctx = await prepareTurn(request)

  // Take over the socket: everything below is SSE, written to the raw response.
  reply.hijack()
  const raw = reply.raw
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const send = (event: string, data: unknown) =>
    raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  let stream: Awaited<ReturnType<typeof chatService.createResponseStream>>
  try {
    stream = await chatService.createResponseStream({
      message,
      mcpToken: ctx.mcpToken,
      mcpBaseUrl: ctx.mcpBaseUrl,
      previousResponseId: ctx.resolvedPreviousResponseId,
      dossierJson: ctx.dossierJson,
    })
  } catch {
    send('error', { message: 'Failed to start the assistant.' })
    raw.end()
    return
  }

  // Client navigated away / closed the tab: stop billing for tokens we won't deliver.
  raw.on('close', () => {
    try {
      stream.controller.abort()
    } catch {
      /* noop */
    }
  })

  let fullText = ''
  let responseId = ''
  try {
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        fullText += event.delta
        send('delta', { delta: event.delta })
      } else if (event.type === 'response.completed') {
        responseId = event.response.id
      }
    }
  } catch {
    send('error', { message: 'The assistant stream was interrupted.' })
    raw.end()
    return
  }

  if (conversationId && responseId) {
    await conversationsService.persistTurn(conversationId, message, fullText, responseId).catch(() => {})
  }

  const suggestions = await suggestionsFor(request.user!.id, ctx.boundSaveId)
  send('done', { responseId, suggestions })
  raw.end()
}

export async function createConversation(
  request: FastifyRequest<{ Body: CreateConversationBody }>,
  reply: FastifyReply,
) {
  const conv = await conversationsService.createConversation(request.user!.id, request.body)

  // Proactive opening message: when the conversation is pinned to a save, Junior greets and
  // surfaces the most pressing thing right away. Fail-open — never block creation on it.
  let openingMessage: { role: 'assistant'; content: string } | null = null
  if (conv.saveId) {
    try {
      const dossierJson = await getSaveDossierJson(request.user!.id, conv.saveId)
      if (dossierJson) {
        const opening = await chatService.generateOpeningMessage(dossierJson)
        if (opening) {
          await conversationsService.seedAssistantMessage(conv.id, opening.reply, opening.responseId)
          openingMessage = { role: 'assistant', content: opening.reply }
        }
      }
    } catch {
      /* fail open — conversation is still created without an opening message */
    }
  }

  return reply.status(201).send({ ...conv, openingMessage })
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
