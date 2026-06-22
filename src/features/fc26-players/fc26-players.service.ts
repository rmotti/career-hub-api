import { prisma } from '../../shared/lib/prisma.js'
import { cacheGet, cacheSet } from '../../shared/utils/cache.js'
import { fetchFitScoreBatch, FitScoreCandidate, FitScoreResult } from '../../shared/lib/fit-score-client.js'
import { toFitScoreClubName, toLeagueCode, toNationality } from '../../shared/utils/fit-score-maps.js'
import { findLeagueByClub } from '../clubs/clubs.service.js'
import type { Fc26Player } from '@prisma/client'

const TTL = {
  list: 60 * 60 * 24,
  detail: 60 * 60 * 24,
  filters: 60 * 60 * 24,
  fitScore: 60 * 60 * 6,
}

// Maps internal position codes to fit-score-svc position groups
const POSITION_GROUP: Record<string, string> = {
  GOL: 'GK',
  ZAG: 'CB',
  LD:  'RB',
  LE:  'LB',
  VOL: 'DM',
  MC:  'CM',
  MD:  'RM',
  ME:  'LM',
  MEI: 'AM',
  PD:  'RW',
  PE:  'LW',
  SA:  'SS',
  ATA: 'CF',
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
  minMarketValue?: number
  maxMarketValue?: number
  minWage?: number
  maxWage?: number
  minPace?: number
  maxPace?: number
  minHeight?: number
  maxHeight?: number
  preferredFoot?: string
  traits?: string[]
  limit?: number
  offset?: number
  saveId?: string
  objective?: string
}

export type Fc26PlayerWithFitScore = Fc26Player & {
  fitScore: number | null
  fitConfidence: 'high' | 'medium' | 'low' | 'none' | null
  fitProfileSize: number | null
}

/** Minimal player shape needed to query the fit-score service (a subset of `Fc26Player`). */
export type FitScorePlayerInput = Pick<
  Fc26Player,
  'sofifaId' | 'age' | 'nation' | 'league' | 'marketValue' | 'positions'
>

function buildCacheKey(filters: Omit<Fc26PlayerFilters, 'saveId' | 'objective'>): string {
  return `fc26:list:${JSON.stringify(filters)}`
}

/**
 * Queries the fit-score service for a set of players against one club + objective and returns
 * a `sofifaId -> FitScoreResult` map. Groups by position group, reads/writes Redis per player,
 * and batches the misses. Fails open: players with no score are simply absent from the map.
 * Shared by the scouting list enrichment and the shortlist (so both honour the same cache).
 */
export async function computeFitScoreMap(
  players: FitScorePlayerInput[],
  clubName: string,
  objective: string
): Promise<Map<number, FitScoreResult>> {
  const clubLeague = findLeagueByClub(clubName)
  const fitScoreClubName = toFitScoreClubName(clubName, clubLeague)

  // Group players by their primary position's position group
  const groups = new Map<string, FitScorePlayerInput[]>()
  for (const player of players) {
    const posGroup = POSITION_GROUP[player.positions[0]] ?? player.positions[0]
    if (!groups.has(posGroup)) groups.set(posGroup, [])
    groups.get(posGroup)!.push(player)
  }

  const scoreMap = new Map<number, FitScoreResult>()

  await Promise.all(
    Array.from(groups.entries()).map(async ([positionGroup, groupPlayers]) => {
      // v2: fit score recalibrado pra escala 0–100 (percentil vs. DNA do clube).
      // O bump invalida entradas 0–1 antigas — sem ele, valores das duas escalas
      // conviveriam por até TTL.fitScore (6h) após o deploy.
      const cachePrefix = `fit-score:v2:${fitScoreClubName}:${positionGroup}:${objective}`

      const uncached: FitScorePlayerInput[] = []
      for (const p of groupPlayers) {
        const cached = await cacheGet<FitScoreResult>(`${cachePrefix}:${p.sofifaId}`)
        if (cached) {
          scoreMap.set(p.sofifaId, cached)
        } else {
          uncached.push(p)
        }
      }

      if (!uncached.length) return

      const candidates: FitScoreCandidate[] = uncached.map((p) => ({
        candidate_id: `sofifa_${p.sofifaId}`,
        candidate: {
          age: p.age,
          nationality: toNationality(p.nation),
          origin_league: toLeagueCode(p.league),
          market_value_eur: (p.marketValue ?? 0) * 1_000_000,
          fee_type: 'paid',
        },
      }))

      const results = await fetchFitScoreBatch(fitScoreClubName, positionGroup, objective, candidates)

      for (const p of uncached) {
        const result = results.get(`sofifa_${p.sofifaId}`)
        if (result) {
          scoreMap.set(p.sofifaId, result)
          await cacheSet(`${cachePrefix}:${p.sofifaId}`, result, TTL.fitScore)
        }
      }
    })
  )

  return scoreMap
}

async function enrichWithFitScore(
  players: Fc26Player[],
  clubName: string,
  objective: string
): Promise<Fc26PlayerWithFitScore[]> {
  const scoreMap = await computeFitScoreMap(players, clubName, objective)

  const enriched = players.map((p) => ({
    ...p,
    fitScore: scoreMap.get(p.sofifaId)?.fit_score ?? null,
    fitConfidence: (scoreMap.get(p.sofifaId)?.confidence ?? null) as Fc26PlayerWithFitScore['fitConfidence'],
    fitProfileSize: scoreMap.get(p.sofifaId)?.profile_size ?? null,
  }))

  // Sort by fitScore desc when scores are available, nulls last
  if (enriched.some((p) => p.fitScore !== null)) {
    enriched.sort((a, b) => {
      if (a.fitScore === null) return 1
      if (b.fitScore === null) return -1
      return b.fitScore - a.fitScore
    })
  }

  return enriched
}

export async function listFc26Players(filters: Fc26PlayerFilters) {
  const { saveId, objective = 'balanced', ...fc26Filters } = filters

  const cacheKey = buildCacheKey(fc26Filters)
  const cached = await cacheGet<{ players: Fc26Player[]; total: number; limit: number; offset: number }>(cacheKey)

  let baseResult: { players: Fc26Player[]; total: number; limit: number; offset: number }

  if (cached) {
    baseResult = cached
  } else {
    const {
      positions, primaryPositions, secondaryPositions,
      nations, clubs, leagues,
      minOvr, maxOvr, minAge, maxAge,
      minPotential, maxPotential,
      minMarketValue, maxMarketValue,
      minWage, maxWage,
      minPace, maxPace,
      minHeight, maxHeight,
      preferredFoot, traits,
      limit = 20, offset = 0,
    } = fc26Filters

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
    if (minMarketValue !== undefined || maxMarketValue !== undefined) {
      where.marketValue = {}
      if (minMarketValue !== undefined) where.marketValue.gte = minMarketValue
      if (maxMarketValue !== undefined) where.marketValue.lte = maxMarketValue
    }
    if (minWage !== undefined || maxWage !== undefined) {
      where.wage = {}
      if (minWage !== undefined) where.wage.gte = minWage
      if (maxWage !== undefined) where.wage.lte = maxWage
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

      baseResult = { players, total, limit, offset }
      await cacheSet(cacheKey, baseResult, TTL.list)
    } else {
      const [players, total] = await Promise.all([
        prisma.fc26Player.findMany({
          where,
          orderBy: { ovr: 'desc' },
          take: Math.min(limit, 100),
          skip: offset,
        }),
        prisma.fc26Player.count({ where }),
      ])

      baseResult = { players, total, limit, offset }
      await cacheSet(cacheKey, baseResult, TTL.list)
    }
  }

  if (!saveId) return baseResult

  const clubStint = await prisma.clubStint.findFirst({
    where: { saveId, isCurrent: true },
    select: { club: true },
  })

  if (!clubStint) return baseResult

  const enrichedPlayers = await enrichWithFitScore(baseResult.players, clubStint.club, objective)

  return { ...baseResult, players: enrichedPlayers }
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
