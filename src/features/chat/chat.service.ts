import OpenAI from 'openai'
import { AppError } from '../../shared/utils/errors.js'
import { COACH_PERSONA } from './persona.js'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o-mini'

export interface SendMessageOptions {
  message: string
  /** Token efêmero com escopo MCP (não o token de sessão completo). Transita pela OpenAI. */
  mcpToken: string
  mcpBaseUrl: string
  previousResponseId?: string
}

export interface SendMessageResult {
  reply: string
  responseId: string
}

export async function sendMessage(options: SendMessageOptions): Promise<SendMessageResult> {
  const { message, mcpToken, mcpBaseUrl, previousResponseId } = options

  if (!process.env.OPENAI_API_KEY) {
    throw new AppError('OPENAI_API_KEY não configurada.', 500)
  }

  const params: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
    model: CHAT_MODEL,
    instructions: COACH_PERSONA,
    input: message,
    tools: [
      {
        type: 'mcp',
        server_label: 'careerhub',
        server_url: `${mcpBaseUrl}/mcp`,
        headers: { Authorization: `Bearer ${mcpToken}` },
        require_approval: 'never',
      },
    ],
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
  }

  const response = await openai.responses.create(params)

  const reply = response.output_text
  if (!reply) {
    throw new AppError('O modelo não retornou resposta.', 502)
  }

  return { reply, responseId: response.id }
}
