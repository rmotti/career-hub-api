import { FastifyInstance } from 'fastify'
import * as chatController from './chat.controller.js'

export async function chatRoutes(app: FastifyInstance) {
  app.post<{ Body: { message: string; previousResponseId?: string } }>(
    '/chat/messages',
    {
      schema: {
        tags: ['Chat'],
        summary: 'Enviar mensagem ao Mister',
        description:
          'Envia uma mensagem ao assistente tático (Mister). O assistente consulta o MCP para dados do save e responde com análise ou recomendação. Passe `previousResponseId` para manter contexto de conversa.',
        body: {
          type: 'object',
          required: ['message'],
          properties: {
            message: { type: 'string', minLength: 1, description: 'Mensagem do usuário' },
            previousResponseId: {
              type: 'string',
              description: 'ID da resposta anterior (OpenAI Responses API) para manter histórico',
            },
          },
        },
      },
    },
    chatController.sendMessage,
  )
}
