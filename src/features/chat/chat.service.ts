import OpenAI from 'openai'
import { AppError } from '../../shared/utils/errors.js'
import { COACH_PERSONA } from './persona.js'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export interface SendMessageOptions {
  message: string
  sessionToken: string
  mcpBaseUrl: string
  previousResponseId?: string
}

export interface SendMessageResult {
  reply: string
  responseId: string
}

export async function sendMessage(options: SendMessageOptions): Promise<SendMessageResult> {
  const { message, sessionToken, mcpBaseUrl, previousResponseId } = options

  if (!process.env.OPENAI_API_KEY) {
    throw new AppError('OPENAI_API_KEY não configurada.', 500)
  }

  const params: Record<string, unknown> = {
    model: 'gpt-4o-mini',
    instructions: COACH_PERSONA,
    input: message,
    tools: [
      {
        type: 'mcp',
        server_label: 'careerhub',
        server_url: `${mcpBaseUrl}/mcp`,
        headers: { Authorization: `Bearer ${sessionToken}` },
        require_approval: 'never',
      },
    ],
  }

  if (previousResponseId) {
    params.previous_response_id = previousResponseId
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (openai.responses.create as any)(params)

  const reply: string | undefined = response.output_text
  if (!reply) {
    throw new AppError('O modelo não retornou resposta.', 502)
  }

  return { reply, responseId: response.id as string }
}
