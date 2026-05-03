import { prisma } from '../../shared/lib/prisma.js'
import { cacheGet, cacheSet } from '../../shared/utils/cache.js'

const TTL = {
  list: 60 * 60 * 24,
  detail: 60 * 60 * 24,
  filters: 60 * 60 * 24,
}

export interface Fc26PlayerFilters {
  positions?: string[]
  primaryPositions?: string[]
  secondaryPositions?: string[]
  nations?: string[]
  clubs?: string[]
  leagues?: string[]
  minOvr?: number
  maxOvr?: number
  minAge?: number
  maxAge?: number
  minPotential?: number
  maxPotential?: number
  minPace?: number
  maxPace?: number
  minHeight?: number
  maxHeight?: number
  preferredFoot?: string
  traits?: string[]
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
    positions, primaryPositions, secondaryPositions,
    nations, clubs, leagues,
    minOvr, maxOvr, minAge, maxAge,
    minPotential, maxPotential,
    minPace, maxPace,
    minHeight, maxHeight,
    preferredFoot, traits,
    limit = 20, offset = 0,
  } = filters

  const where: any = {}

  if (positions?.length)    where.positions     = { hasSome: positions }
  if (nations?.length)      where.nation        = { in: nations }
  if (clubs?.length)        where.club          = { in: clubs }
  if (leagues?.length)      where.league        = { in: leagues }
  if (preferredFoot)        where.preferredFoot = preferredFoot
  if (traits?.length)       where.playerTraits  = { hasSome: traits }

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
  if (minPotential !== undefined || maxPotential !== undefined) {
    where.potential = {}
    if (minPotential !== undefined) where.potential.gte = minPotential
    if (maxPotential !== undefined) where.potential.lte = maxPotential
  }
  if (minPace !== undefined || maxPace !== undefined) {
    where.pace = {}
    if (minPace !== undefined) where.pace.gte = minPace
    if (maxPace !== undefined) where.pace.lte = maxPace
  }
  if (minHeight !== undefined || maxHeight !== undefined) {
    where.height = {}
    if (minHeight !== undefined) where.height.gte = minHeight
    if (maxHeight !== undefined) where.height.lte = maxHeight
  }

  if (primaryPositions?.length || secondaryPositions?.length) {
    // Pre-filter in DB: player must have at least one of the requested positions anywhere
    const candidatePositions = [...(primaryPositions ?? []), ...(secondaryPositions ?? [])]
    where.positions = { hasSome: candidatePositions }

    const allPlayers = await prisma.fc26Player.findMany({
      where,
      orderBy: { ovr: 'desc' },
    })

    const filtered = allPlayers.filter((p) => {
      const primary = p.positions[0]
      const secondary = p.positions.slice(1)
      if (primaryPositions?.length && !primaryPositions.includes(primary)) return false
      if (secondaryPositions?.length && !secondary.some((pos) => secondaryPositions.includes(pos))) return false
      return true
    })

    const total = filtered.length
    const players = filtered.slice(offset, offset + Math.min(limit, 100))

    const result = { players, total, limit, offset }
    await cacheSet(cacheKey, result, TTL.list)
    return result
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

  const player = await prisma.fc26Player.findUnique({ where: { sofifaId } })
  if (!player) return null

  await cacheSet(cacheKey, player, TTL.detail)
  return player
}

export async function getFc26Filters() {
  const cacheKey = 'fc26:filters'
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  const [nationsRaw, leaguesRaw, clubsRaw] = await Promise.all([
    prisma.fc26Player.findMany({
      where: { nation: { not: null } },
      select: { nation: true },
      distinct: ['nation'],
      orderBy: { nation: 'asc' },
    }),
    prisma.fc26Player.findMany({
      where: { league: { not: null } },
      select: { league: true },
      distinct: ['league'],
      orderBy: { league: 'asc' },
    }),
    prisma.fc26Player.findMany({
      where: { club: { not: null }, league: { not: null } },
      select: { club: true, league: true },
      distinct: ['club'],
      orderBy: { club: 'asc' },
    }),
  ])

  const positions = ['GOL','ZAG','LE','LD','VOL','MC','ME','MD','MEI','PE','PD','SA','ATA']
  const nations = nationsRaw.map((r) => r.nation!)
  const leagues = leaguesRaw.map((r) => r.league!)

  const clubsByLeague: Record<string, string[]> = {}
  for (const { club, league } of clubsRaw) {
    if (!club || !league) continue
    if (!clubsByLeague[league]) clubsByLeague[league] = []
    clubsByLeague[league].push(club)
  }

  const result = { positions, nations, leagues, clubsByLeague }
  await cacheSet(cacheKey, result, TTL.filters)
  return result
}
