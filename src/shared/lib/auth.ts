import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { admin, bearer } from 'better-auth/plugins'
import { prisma } from './prisma.js'
import { getTrustedOrigins } from '../utils/origins.js'
import { invalidateUserSessions } from '../utils/session-cache.js'

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,

  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },

  plugins: [
    admin({
      adminUserIds: [], // preenchido dinamicamente via ADMIN_USER_IDS no .env (opcional)
      defaultRole: 'user',
    }),
    bearer(),
  ],

  user: {
    additionalFields: {
      plan: {
        type: 'string',
        defaultValue: 'FREE',
        input: false,
      },
    },
  },

  // Qualquer update no usuário (ban, troca de role/plano) invalida o cache de sessão
  // dele, fechando a janela de revogação de até 5 min. Roda após o commit da transação.
  databaseHooks: {
    user: {
      update: {
        after: async (user) => {
          await invalidateUserSessions(user.id)
        },
      },
    },
  },

  trustedOrigins: getTrustedOrigins(),

  rateLimit: {
    // DISABLE_RATE_LIMIT é um foot-gun de load test: nunca deve desligar o limiter em produção.
    enabled: process.env.NODE_ENV === 'production' || process.env.DISABLE_RATE_LIMIT !== 'true',
    window: 60,
    max: 100,
  },

  ...(process.env.NODE_ENV === 'production' && {
    advanced: {
      defaultCookieAttributes: {
        sameSite: 'none',
        secure: true,
        partitioned: true,
      },
    },
  }),
})

export type Auth = typeof auth
export type Session = typeof auth.$Infer.Session
