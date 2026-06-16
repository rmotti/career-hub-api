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
 * Copies status/headers from the Better Auth Response onto the Fastify reply, but:
 * - handles `set-cookie` via `getSetCookie()` (`forEach` joins multiple cookies into an
 *   invalid string) and allows appending our own extra cookies;
 * - omits `content-length`/`content-encoding` (Fastify recomputes them when sending the payload).
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
 * Shared sign-in/sign-up handler: forwards the Better Auth response and, on success,
 * issues the httpOnly `session_token` cookie, the `csrf_token` cookie and returns the `csrfToken`
 * in the body + header (the SPA can't read cookies cross-site, so it receives the CSRF token
 * here). The `token` is used ONLY to set the cookie and is then removed from the body —
 * post-cutover it no longer lives anywhere accessible to JS, closing the login XSS hole.
 */
async function handleSessionResponse(response: Response, reply: FastifyReply) {
  const text = await response.text()

  if (response.ok) {
    try {
      const body = JSON.parse(text) as { token?: string; [k: string]: unknown }
      if (body && typeof body.token === 'string') {
        const csrfToken = generateCsrfToken()
        const sessionToken = body.token
        delete body.token // don't expose the token to JS — it lives only in the httpOnly cookie
        body.csrfToken = csrfToken

        forwardHeaders(response, reply, [sessionCookie(sessionToken), csrfCookie(csrfToken)])
        reply.header('X-CSRF-Token', csrfToken)
        reply.header('content-type', 'application/json; charset=utf-8')
        reply.status(response.status)
        return reply.send(JSON.stringify(body))
      }
    } catch {
      // non-JSON or unexpected body → forward unchanged
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
    // Resolve the session via the SAME path as requireAuth: extract the token from the httpOnly
    // `session_token` cookie (or legacy Bearer) and inject it as Bearer into Better Auth. Forwarding
    // the raw request doesn't work cross-site — Better Auth doesn't recognize our cookie,
    // so the SPA was dropped back to login on every refresh.
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
    // Token may come from the cookie (new flow) or Bearer (legacy) — invalidate the right cache.
    const token = extractSessionToken(request)
    const response = await auth.handler(toBetterAuthRequest(request as any))
    await invalidateSessionCache(token)

    // Expire the cookies on every path (including Better Auth's error fallback).
    const clearedCookies = [clearedSessionCookie(), clearedCsrfCookie()]
    if (response.status >= 500) {
      reply.header('set-cookie', clearedCookies)
      return reply.status(200).send({ success: true })
    }
    forwardHeaders(response, reply, clearedCookies)
    reply.status(response.status)
    return reply.send(await response.text())
  })

  // Refills the CSRF token. The SPA calls it on boot (after a reload it loses the in-memory token
  // and can't read the cookie cross-site). Returns the current cookie's token or issues a new one.
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

  // Hidden catch-all — Better Auth's internal routes (password reset, etc.)
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
