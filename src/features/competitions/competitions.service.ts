import { prisma } from '../../shared/lib/prisma.js'
import { cacheGet, cacheSet } from '../../shared/utils/cache.js'

const TTL = 60 * 60 * 24 // 24h — static data

export async function listCompetitions() {
  const key = 'competitions:all'
  const cached = await cacheGet<unknown[]>(key)
  if (cached) return cached

  const result = await prisma.competition.findMany({
    orderBy: [{ country: 'asc' }, { type: 'asc' }, { name: 'asc' }],
  })
  await cacheSet(key, result, TTL)
  return result
}

export async function listEuropeanCompetitions() {
  const key = 'competitions:european'
  const cached = await cacheGet<unknown[]>(key)
  if (cached) return cached

  const result = await prisma.competition.findMany({
    where: { type: 'EuropeanCup' },
    orderBy: { name: 'asc' },
  })
  await cacheSet(key, result, TTL)
  return result
}

export async function getCompetitionIdsByCountry(country: string): Promise<string[]> {
  const key = `competitions:country:${country}:ids`
  const cached = await cacheGet<string[]>(key)
  if (cached) return cached

  const comps = await prisma.competition.findMany({
    where: { country },
    select: { id: true },
  })
  const ids = comps.map((c) => c.id)
  await cacheSet(key, ids, TTL)
  return ids
}
