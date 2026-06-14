import { FastifyInstance, FastifyReply } from 'fastify'
import { auth } from '../../shared/lib/auth.js'
import { invalidateSessionCache, extractSessionToken, getSession } from '../../shared/utils/auth-hooks.js'
import {
  sessionCookie,
  csrfCookie,
  clearedSessionCookie,
  clearedCsrfCookie,
  generateCsrfToken,
  parseCookies,
  CSRF_COOKIE,
} from '../../shared/utils/cookies.js'

function toBetterAuthRequest(request: {
  url: string
  method: string
  protocol: string
  hostname: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}) {
  const baseUrl = process.env.BETTER_AUTH_URL ?? `${request.protocol}://${request.hostname}`
  return new Request(new URL(request.url, baseUrl), {
    method: request.method,
    headers: request.headers as HeadersInit,
    body:
      request.method !== 'GET' && request.method !== 'HEAD'
        ? JSON.stringify(request.body)
        : undefined,
  })
}

/**
 * Copia status/headers do Response do Better Auth para o reply do Fastify, mas:
 * - trata `set-cookie` via `getSetCookie()` (o `forEach` junta múltiplos cookies numa string
 *   inválida) e permite anexar cookies extras nossos;
 * - omite `content-length`/`content-encoding` (o Fastify recalcula ao enviar o payload).
 */
function forwardHeaders(response: Response, reply: FastifyReply, extraCookies: string[] = []) {
  const upstreamCookies =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []

  response.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower === 'set-cookie' || lower === 'content-length' || lower === 'content-encoding') return
    reply.header(key, value)
  })

  const cookies = [...upstreamCookies, ...extraCookies]
  if (cookies.length > 0) reply.header('set-cookie', cookies)
}

/**
 * Handler comum de sign-in/sign-up: encaminha a resposta do Better Auth e, no sucesso,
 * emite o cookie httpOnly `session_token`, o cookie `csrf_token` e devolve o `csrfToken`
 * no corpo + header (o SPA não consegue ler cookies cross-site, então recebe o token CSRF
 * por aqui). O `token` é usado APENAS para setar o cookie e é então removido do corpo —
 * pós-cutover ele não vive mais em lugar acessível ao JS, fechando a brecha de XSS no login.
 */
async function handleSessionResponse(response: Response, reply: FastifyReply) {
  const text = await response.text()

  if (response.ok) {
    try {
      const body = JSON.parse(text) as { token?: string; [k: string]: unknown }
      if (body && typeof body.token === 'string') {
        const csrfToken = generateCsrfToken()
        const sessionToken = body.token
        delete body.token // não expõe o token ao JS — vive só no cookie httpOnly
        body.csrfToken = csrfToken

        forwardHeaders(response, reply, [sessionCookie(sessionToken), csrfCookie(csrfToken)])
        reply.header('X-CSRF-Token', csrfToken)
        reply.header('content-type', 'application/json; charset=utf-8')
        reply.status(response.status)
        return reply.send(JSON.stringify(body))
      }
    } catch {
      // corpo não-JSON ou inesperado → encaminha sem alterar
    }
  }

  forwardHeaders(response, reply)
  reply.status(response.status)
  return reply.send(text)
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/sign-up/email', {
    schema: {
      tags: ['Auth'],
      summary: 'Criar conta',
      security: [],
      body: {
        type: 'object',
        required: ['name', 'email', 'password'],
        properties: {
          name: { type: 'string', example: 'João Silva' },
          email: { type: 'string', format: 'email', example: 'joao@email.com' },
          password: { type: 'string', minLength: 8, example: 'minhasenha123' },
        },
      },
      response: {
        200: {
          description: 'Conta criada com sucesso. O `session_token` vem via Set-Cookie httpOnly; use o `csrfToken` no header X-CSRF-Token nas escritas.',
          type: 'object',
          properties: {
            csrfToken: { type: 'string', description: 'Token CSRF — ecoe em X-CSRF-Token nas escritas' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string' },
                role: { type: 'string', enum: ['admin', 'user'] },
                plan: { type: 'string', enum: ['FREE', 'PRO', 'PREMIUM'] },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const response = await auth.handler(toBetterAuthRequest(request as any))
    return handleSessionResponse(response, reply)
  })

  app.post('/auth/sign-in/email', {
    schema: {
      tags: ['Auth'],
      summary: 'Fazer login',
      security: [],
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'joao@email.com' },
          password: { type: 'string', example: 'minhasenha123' },
        },
      },
      response: {
        200: {
          description: 'Login realizado com sucesso. O `session_token` vem via Set-Cookie httpOnly; use o `csrfToken` no header X-CSRF-Token nas escritas.',
          type: 'object',
          properties: {
            csrfToken: { type: 'string', description: 'Token CSRF — ecoe em X-CSRF-Token nas escritas' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string' },
                role: { type: 'string', enum: ['admin', 'user'] },
                plan: { type: 'string', enum: ['FREE', 'PRO', 'PREMIUM'] },
              },
            },
          },
        },
        401: {
          description: 'Credenciais inválidas',
          type: 'object',
          properties: {
            error: { type: 'string' },
            statusCode: { type: 'number' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const response = await auth.handler(toBetterAuthRequest(request as any))
    return handleSessionResponse(response, reply)
  })

  app.get('/auth/session', {
    schema: {
      tags: ['Auth'],
      summary: 'Sessão atual',
      security: [],
      response: {
        200: {
          description: 'Dados do usuário logado',
          type: 'object',
          properties: {
            session: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                expiresAt: { type: 'string', format: 'date-time' },
                userId: { type: 'string' },
              },
            },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string' },
                role: { type: 'string', enum: ['admin', 'user'] },
                plan: { type: 'string', enum: ['FREE', 'PRO', 'PREMIUM'] },
              },
            },
          },
        },
        401: {
          description: 'Não autenticado',
          type: 'object',
          properties: {
            error: { type: 'string' },
            statusCode: { type: 'number' },
          },
        },
      },
    },
  }, async (request, reply) => {
    // Resolve a sessão pelo MESMO caminho do requireAuth: extrai o token do cookie httpOnly
    // `session_token` (ou Bearer legado) e injeta como Bearer no Better Auth. Encaminhar a
    // requisição crua não funciona cross-site — o Better Auth não reconhece o nosso cookie,
    // então o SPA caía no login a cada refresh.
    const session = await getSession(request)
    if (!session?.user) {
      return reply.status(401).send({ error: 'Não autenticado.', statusCode: 401 })
    }
    return reply.send(session)
  })

  app.post('/auth/sign-out', {
    schema: {
      tags: ['Auth'],
      summary: 'Logout',
      response: {
        200: {
          description: 'Logout realizado com sucesso',
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
        },
      },
    },
  }, async (request, reply) => {
    // Token pode vir do cookie (novo fluxo) ou do Bearer (legado) — invalida o cache certo.
    const token = extractSessionToken(request)
    const response = await auth.handler(toBetterAuthRequest(request as any))
    await invalidateSessionCache(token)

    // Expira os cookies em qualquer caminho (inclusive no fallback de erro do Better Auth).
    const clearedCookies = [clearedSessionCookie(), clearedCsrfCookie()]
    if (response.status >= 500) {
      reply.header('set-cookie', clearedCookies)
      return reply.status(200).send({ success: true })
    }
    forwardHeaders(response, reply, clearedCookies)
    reply.status(response.status)
    return reply.send(await response.text())
  })

  // Reabastece o token CSRF. O SPA chama no boot (após reload perde o token da memória e
  // não consegue ler o cookie cross-site). Devolve o token do cookie atual ou emite um novo.
  app.get('/auth/csrf', {
    schema: {
      tags: ['Auth'],
      summary: 'Token CSRF atual',
      security: [],
      response: {
        200: {
          description: 'Token CSRF para usar no header X-CSRF-Token das escritas',
          type: 'object',
          properties: {
            csrfToken: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const existing = parseCookies(request)[CSRF_COOKIE]
    const csrfToken = existing ?? generateCsrfToken()
    if (!existing) reply.header('set-cookie', [csrfCookie(csrfToken)])
    reply.header('X-CSRF-Token', csrfToken)
    return reply.send({ csrfToken })
  })

  // Catch-all oculto — rotas internas do Better Auth (reset de senha, etc.)
  app.route({
    method: ['GET', 'POST'],
    url: '/auth/*',
    schema: { hide: true },
    async handler(request, reply) {
      const response = await auth.handler(toBetterAuthRequest(request as any))
      reply.status(response.status)
      response.headers.forEach((value, key) => reply.header(key, value))
      return reply.send(await response.text())
    },
  })
}
