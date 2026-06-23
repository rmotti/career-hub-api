import { FastifyInstance } from 'fastify'
import * as chatController from './chat.controller.js'

const conversationSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string', nullable: true },
    saveId: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
}

const messageSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    role: { type: 'string', enum: ['user', 'assistant'] },
    content: { type: 'string' },
    openaiResponseId: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
}

// Create returns the conversation plus an optional proactive opening message (save-pinned only).
const createConversationResponseSchema = {
  type: 'object',
  properties: {
    ...conversationSchema.properties,
    openingMessage: {
      type: 'object',
      nullable: true,
      properties: {
        role: { type: 'string' },
        content: { type: 'string' },
      },
    },
  },
}

const sendMessageBodySchema = {
  type: 'object',
  required: ['message'],
  properties: {
    message: { type: 'string', minLength: 1 },
    previousResponseId: {
      type: 'string',
      description: 'OpenAI Responses API previous response ID (ignored when conversationId is set)',
    },
    conversationId: {
      type: 'string',
      description: 'Persist this turn in an existing conversation and auto-derive context',
    },
  },
}

export async function chatRoutes(app: FastifyInstance) {
  app.post<{ Body: { message: string; previousResponseId?: string; conversationId?: string } }>(
    '/chat/messages',
    {
      schema: {
        tags: ['Chat'],
        summary: 'Send a message to the coach',
        body: sendMessageBodySchema,
        response: {
          200: {
            type: 'object',
            properties: {
              reply: { type: 'string' },
              responseId: { type: 'string' },
              suggestions: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    chatController.sendMessage,
  )

  app.post<{ Body: { message: string; previousResponseId?: string; conversationId?: string } }>(
    '/chat/messages/stream',
    {
      schema: {
        tags: ['Chat'],
        summary: 'Stream a message to the coach (Server-Sent Events)',
        description:
          'Same input as POST /chat/messages but streams the reply over SSE. Events: `delta` ({ delta }), `done` ({ responseId, suggestions }), `error` ({ message }).',
        body: sendMessageBodySchema,
      },
    },
    chatController.sendMessageStream,
  )

  app.post<{ Body: { title?: string; saveId?: string } }>(
    '/chat/conversations',
    {
      schema: {
        tags: ['Chat'],
        summary: 'Create a new chat conversation',
        body: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            saveId: { type: 'string' },
          },
        },
        response: { 201: createConversationResponseSchema },
      },
    },
    chatController.createConversation,
  )

  app.get<{ Querystring: { saveId?: string } }>(
    '/chat/conversations',
    {
      schema: {
        tags: ['Chat'],
        summary: 'List conversations for the current user',
        querystring: {
          type: 'object',
          properties: { saveId: { type: 'string' } },
        },
        response: { 200: { type: 'array', items: conversationSchema } },
      },
    },
    chatController.listConversations,
  )

  app.delete<{ Params: { conversationId: string } }>(
    '/chat/conversations/:conversationId',
    {
      schema: {
        tags: ['Chat'],
        summary: 'Delete a conversation and all its messages',
        params: {
          type: 'object',
          required: ['conversationId'],
          properties: { conversationId: { type: 'string' } },
        },
        response: { 204: { type: 'null' } },
      },
    },
    chatController.deleteConversation,
  )

  app.get<{ Params: { conversationId: string } }>(
    '/chat/conversations/:conversationId/messages',
    {
      schema: {
        tags: ['Chat'],
        summary: 'List messages in a conversation',
        params: {
          type: 'object',
          required: ['conversationId'],
          properties: { conversationId: { type: 'string' } },
        },
        response: { 200: { type: 'array', items: messageSchema } },
      },
    },
    chatController.getMessages,
  )
}
