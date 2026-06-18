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

  // Any update to the user (ban, role/plan change) invalidates their session
  // cache, closing the up-to-5-min revocation window. Runs after the transaction commits.
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
    // DISABLE_RATE_LIMIT is a load-test foot-gun: it must never disable the limiter in production.
    enabled: process.env.NODE_ENV === 'production' || process.env.DISABLE_RATE_LIMIT !== 'true',
    window: 60,
    max: 100,
  },

  // The SPA reaches the API same-origin (Vercel/Vite proxy `/api/*`), so Better Auth's own cookies
  // are first-party: `SameSite=Lax` + `Secure` (was cross-site `none`/`partitioned`). We do NOT set
  // `advanced.crossSubDomainCookies` and never set a `domain`, so every cookie stays host-only —
  // mandatory because the Vercel rewrite forwards `Set-Cookie` without rewriting `Domain`.
  ...(process.env.NODE_ENV === 'production' && {
    advanced: {
      defaultCookieAttributes: {
        sameSite: 'lax',
        secure: true,
      },
    },
  }),
})

export type Auth = typeof auth
export type Session = typeof auth.$Infer.Session
