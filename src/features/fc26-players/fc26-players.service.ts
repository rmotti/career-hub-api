import { prisma } from '../../shared/lib/prisma.js'
import { cacheGet, cacheSet } from '../../shared/utils/cache.js'

const TTL = {
  list: 60 * 60 * 24,   // 24h — dataset estático
  detail: 60 * 60 * 24,
}

export interface Fc26PlayerFilters {
  positions?: string[]
  minOvr?: number
  maxOvr?: number
  minAge?: number
  maxAge?: number
  minPotential?: number
  nation?: string
  limit?: number
  offset?: number
}

function buildCacheKey(filters: Fc26PlayerFilters): string {
  return `fc26:list:${JSON.stringify(filters)}`
}

export async function listFc26Players(filters: Fc26PlayerFilters) {
  const cacheKey = buildCacheKey(filters)
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  const {
    positions,
    minOvr,
    maxOvr,
    minAge,
    maxAge,
    minPotential,
    nation,
    limit = 20,
    offset = 0,
  } = filters

  const where: any = {}

  if (positions?.length) {
    where.positions = { hasSome: positions }
  }
  if (minOvr !== undefined || maxOvr !== undefined) {
    where.ovr = {}
    if (minOvr !== undefined) where.ovr.gte = minOvr
    if (maxOvr !== undefined) where.ovr.lte = maxOvr
  }
  if (minAge !== undefined || maxAge !== undefined) {
    where.age = {}
    if (minAge !== undefined) where.age.gte = minAge
    if (maxAge !== undefined) where.age.lte = maxAge
  }
  if (minPotential !== undefined) {
    where.potential = { gte: minPotential }
  }
  if (nation) {
    where.nation = { contains: nation, mode: 'insensitive' }
  }

  const [players, total] = await Promise.all([
    prisma.fc26Player.findMany({
      where,
      orderBy: { ovr: 'desc' },
      take: Math.min(limit, 100),
      skip: offset,
    }),
    prisma.fc26Player.count({ where }),
  ])

  const result = { players, total, limit, offset }
  await cacheSet(cacheKey, result, TTL.list)
  return result
}

export async function getFc26PlayerById(sofifaId: number) {
  const cacheKey = `fc26:detail:${sofifaId}`
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  const player = await prisma.fc26Player.findUnique({
    where: { sofifaId },
  })

  if (!player) return null

  await cacheSet(cacheKey, player, TTL.detail)
  return player
}
