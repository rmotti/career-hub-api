import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { admin, bearer } from 'better-auth/plugins'
import { prisma } from './prisma.js'

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

  trustedOrigins: process.env.TRUSTED_ORIGINS?.split(',') ?? [],

  rateLimit: {
    enabled: process.env.DISABLE_RATE_LIMIT !== 'true',
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
