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
  /** Dossiê JSON da save, anexado só no primeiro turno para aterrar o modelo. */
  dossierJson?: string
}

export interface SendMessageResult {
  reply: string
  responseId: string
}

/** First turn only: prepend the save briefing as grounding context (stays in the response chain). */
function buildInput(message: string, dossierJson?: string): string {
  return dossierJson
    ? `# ACTIVE SAVE BRIEFING (auto-attached context — ground your answers in this; do not echo it back verbatim)\n${dossierJson}\n\n# USER MESSAGE\n${message}`
    : message
}

function mcpTool(mcpToken: string, mcpBaseUrl: string): OpenAI.Responses.Tool {
  return {
    type: 'mcp',
    server_label: 'careerhub',
    server_url: `${mcpBaseUrl}/mcp`,
    headers: { Authorization: `Bearer ${mcpToken}` },
    require_approval: 'never',
  }
}

function assertConfigured() {
  if (!process.env.OPENAI_API_KEY) {
    throw new AppError('OPENAI_API_KEY não configurada.', 500)
  }
}

export async function sendMessage(options: SendMessageOptions): Promise<SendMessageResult> {
  const { message, mcpToken, mcpBaseUrl, previousResponseId, dossierJson } = options
  assertConfigured()

  const params: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
    model: CHAT_MODEL,
    instructions: COACH_PERSONA,
    input: buildInput(message, dossierJson),
    tools: [mcpTool(mcpToken, mcpBaseUrl)],
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
  }

  const response = await openai.responses.create(params)

  const reply = response.output_text
  if (!reply) {
    throw new AppError('O modelo não retornou resposta.', 502)
  }

  return { reply, responseId: response.id }
}

/**
 * Streaming twin of `sendMessage`: returns the raw OpenAI event stream so the controller can
 * forward text deltas over SSE and persist the final turn on completion.
 */
export function createResponseStream(options: SendMessageOptions) {
  const { message, mcpToken, mcpBaseUrl, previousResponseId, dossierJson } = options
  assertConfigured()

  const params: OpenAI.Responses.ResponseCreateParamsStreaming = {
    model: CHAT_MODEL,
    instructions: COACH_PERSONA,
    input: buildInput(message, dossierJson),
    tools: [mcpTool(mcpToken, mcpBaseUrl)],
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    stream: true,
  }

  return openai.responses.create(params)
}

const OPENING_DIRECTIVE = `Open the conversation as Junior in ONE short paragraph (2–3 lines): greet the manager and surface the single most pressing thing about the save from the briefing below (a critical gap, a finance constraint, or a standout). Lead — do not ask what they want. End with one concrete suggestion. Use only the briefing; do not call tools, do not invent data.`

/**
 * Generates Junior's proactive opening message from the save dossier (no tools — the briefing is
 * enough). Fails open: returns null if OpenAI is unconfigured or the call fails, so conversation
 * creation never breaks because of it.
 */
export async function generateOpeningMessage(dossierJson: string): Promise<SendMessageResult | null> {
  if (!process.env.OPENAI_API_KEY) return null
  try {
    const response = await openai.responses.create({
      model: CHAT_MODEL,
      instructions: COACH_PERSONA,
      input: `${OPENING_DIRECTIVE}\n\n# SAVE BRIEFING\n${dossierJson}`,
    })
    const reply = response.output_text
    if (!reply) return null
    return { reply, responseId: response.id }
  } catch {
    return null
  }
}
