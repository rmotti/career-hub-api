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
      role: {
        type: 'string',
        defaultValue: 'USER',
        input: false, // não pode ser definido pelo usuário no cadastro
      },
      plan: {
        type: 'string',
        defaultValue: 'FREE',
        input: false,
      },
    },
  },

  trustedOrigins: process.env.TRUSTED_ORIGINS?.split(',') ?? [],
})

export type Auth = typeof auth
export type Session = typeof auth.$Infer.Session
