import { PrismaClient } from '@prisma/client'
import { withDbRetry } from './db-retry.js'

function buildDatabaseUrl() {
  const url = new URL(process.env.DATABASE_URL!)
  url.searchParams.set('connection_limit', '10')
  url.searchParams.set('pool_timeout', '20')
  return url.toString()
}

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: process.env.NODE_ENV !== 'production' ? ['query'] : [],
    datasources: { db: { url: buildDatabaseUrl() } },
  }).$extends({
    // Auto-retry every operation on a connection-pool timeout (P2024) — see db-retry.ts.
    // P2024 happens at pool acquisition (pre-execution); an interactive transaction acquires its
    // connection once up front, so its inner statements never raise P2024 — the retry can't
    // re-run a statement outside its transaction. Cast back to PrismaClient so the extended
    // type doesn't ripple into every service's `Prisma.TransactionClient` helper signatures.
    query: {
      $allOperations({ args, query }) {
        return withDbRetry(() => query(args))
      },
    },
  })
  return client as unknown as PrismaClient
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
