import { FastifyInstance } from 'fastify'
import { auth } from '../../shared/lib/auth'

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
          description: 'Conta criada com sucesso',
          type: 'object',
          properties: {
            token: { type: 'string', description: 'Token de sessão' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string' },
                role: { type: 'string', enum: ['ADMIN', 'USER'] },
                plan: { type: 'string', enum: ['FREE', 'PRO', 'PREMIUM'] },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const response = await auth.handler(toBetterAuthRequest(request as any))
    reply.status(response.status)
    response.headers.forEach((value, key) => reply.header(key, value))
    return reply.send(await response.text())
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
          description: 'Login realizado com sucesso — copie o `token` e use como Bearer token nas demais rotas',
          type: 'object',
          properties: {
            token: { type: 'string' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string' },
                role: { type: 'string', enum: ['ADMIN', 'USER'] },
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
    reply.status(response.status)
    response.headers.forEach((value, key) => reply.header(key, value))
    return reply.send(await response.text())
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
                role: { type: 'string', enum: ['ADMIN', 'USER'] },
                plan: { type: 'string', enum: ['FREE', 'PRO', 'PREMIUM'] },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const response = await auth.handler(toBetterAuthRequest(request as any))
    if (response.status === 404) return reply.status(200).send(null)
    reply.status(response.status)
    response.headers.forEach((value, key) => reply.header(key, value))
    return reply.send(await response.text())
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
    const response = await auth.handler(toBetterAuthRequest(request as any))
    if (response.status >= 500) return reply.status(200).send({ success: true })
    reply.status(response.status)
    response.headers.forEach((value, key) => reply.header(key, value))
    return reply.send(await response.text())
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
