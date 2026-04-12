import { prisma } from '../../shared/lib/prisma.js'
import { NotFoundError, AppError } from '../../shared/utils/errors.js'
import { formatMarketValue, formatSalary } from '../../shared/utils/currency.js'
import { Position, PlayerStatus } from '@prisma/client'
import { cacheGet, cacheSet, cacheInvalidate, cacheInvalidatePattern } from '../../shared/utils/cache.js'

const TTL = {
  playersList: 60 * 60,        // 1h
  playersActive: 60 * 30,      // 30min
  player: 60 * 60,             // 1h
}

const POSITION_ORDER: Position[] = [
  'GOL', 'LD', 'LE', 'ZAG', 'VOL', 'MC', 'ME', 'MD', 'MEI', 'PE', 'PD', 'SA', 'ATA',
]

function formatPlayer<T extends { marketValue: number | null; salary: number | null }>(p: T) {
  return {
    ...p,
    marketValueFormatted: formatMarketValue(p.marketValue),
    salaryFormatted: formatSalary(p.salary),
  }
}

export async function listPlayers(saveId: string, activeOnly?: boolean, season?: string) {
  let cacheKey: string
  let ttl: number

  if (activeOnly) {
    cacheKey = season
      ? `save:${saveId}:players:active:${season}`
      : `save:${saveId}:players:active`
    ttl = TTL.playersActive
  } else {
    cacheKey = `save:${saveId}:players`
    ttl = TTL.playersList
  }

  const cached = await cacheGet<unknown[]>(cacheKey)
  if (cached) return cached

  const result = await fetchPlayers(saveId, activeOnly, season)
  await cacheSet(cacheKey, result, ttl)
  return result
}

async function fetchPlayers(saveId: string, activeOnly?: boolean, season?: string) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: { where: { isCurrent: true } } },
  })
  if (!save) throw new NotFoundError('Save não encontrado.')

  if (activeOnly) {
    const currentStint = save.clubStints[0]
    if (!currentStint) return []

    const isCurrentSeason = !season || season === save.currentSeason

    if (isCurrentSeason) {
      const players = await prisma.player.findMany({
        where: { saveId, activeClubStintId: currentStint.id },
        include: {
          seasonStats: {
            where: { clubStintId: currentStint.id, season: save.currentSeason },
          },
          ovrHistory: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      })

      const sorted = [...players].sort(
        (a, b) => POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position)
      )

      return sorted.map((p) => {
        const s = p.seasonStats[0] ?? null
        const lastHistory = p.ovrHistory[0] ?? null
        const { seasonStats: _, ovrHistory: __, ...rest } = p
        const stats = s
          ? { ...s, goalContributions: s.goals + s.assists }
          : { goals: 0, assists: 0, matches: 0, yellowCards: 0, redCards: 0, cleanSheets: 0, goalContributions: 0 }
        return {
          ...formatPlayer(rest),
          currentSeasonStats: stats,
          ovrDelta: lastHistory !== null ? p.ovr - lastHistory.ovr : null,
          marketValueDelta: (lastHistory !== null && p.marketValue !== null && lastHistory.marketValue !== null)
            ? p.marketValue - lastHistory.marketValue
            : null,
        }
      })
    }

    // Historical season: players who had stats recorded in that season for this club stint
    const historicalStats = await prisma.playerSeasonStats.findMany({
      where: { clubStintId: currentStint.id, season },
      include: { player: true },
    })

    const sorted = [...historicalStats].sort(
      (a, b) => POSITION_ORDER.indexOf(a.player.position) - POSITION_ORDER.indexOf(b.player.position)
    )

    return sorted.map(({ player: p, ...s }) => ({
      ...formatPlayer(p),
      currentSeasonStats: { ...s, goalContributions: s.goals + s.assists },
      ovrDelta: null,
      marketValueDelta: null,
    }))
  }

  const players = await prisma.player.findMany({
    where: { saveId },
    include: { seasonStats: true },
    orderBy: { createdAt: 'asc' },
  })

  return players.map((p) => {
    const totals = p.seasonStats.reduce(
      (acc, s) => ({
        goals: acc.goals + s.goals,
        assists: acc.assists + s.assists,
        matches: acc.matches + s.matches,
        yellowCards: acc.yellowCards + s.yellowCards,
        redCards: acc.redCards + s.redCards,
        cleanSheets: acc.cleanSheets + s.cleanSheets,
      }),
      { goals: 0, assists: 0, matches: 0, yellowCards: 0, redCards: 0, cleanSheets: 0 }
    )
    const { seasonStats: _, ...rest } = p
    return {
      ...formatPlayer(rest),
      totalStats: { ...totals, goalContributions: totals.goals + totals.assists },
    }
  })
}

export async function getPlayerById(saveId: string, playerId: string) {
  const key = `save:${saveId}:player:${playerId}`
  const cached = await cacheGet<object>(key)
  if (cached) return cached

  const result = await fetchPlayerById(saveId, playerId)
  await cacheSet(key, result, TTL.player)
  return result
}

async function fetchPlayerById(saveId: string, playerId: string) {
  const save = await prisma.save.findUnique({ where: { id: saveId } })
  if (!save) throw new NotFoundError('Save não encontrado.')

  const playerExists = await prisma.player.findUnique({ where: { id: playerId } })
  if (!playerExists) throw new NotFoundError('Jogador não encontrado.')

  const player = await prisma.player.findFirst({
    where: { id: playerId, saveId },
    include: {
      seasonStats: {
        include: { clubStint: true },
      },
      ovrHistory: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!player) throw new NotFoundError('Jogador não encontrado neste save.')

  const totals = player.seasonStats.reduce(
    (acc, s) => ({
      goals: acc.goals + s.goals,
      assists: acc.assists + s.assists,
      matches: acc.matches + s.matches,
      yellowCards: acc.yellowCards + s.yellowCards,
      redCards: acc.redCards + s.redCards,
      cleanSheets: acc.cleanSheets + s.cleanSheets,
    }),
    { goals: 0, assists: 0, matches: 0, yellowCards: 0, redCards: 0, cleanSheets: 0 }
  )

  const totalStats = { ...totals, goalContributions: totals.goals + totals.assists }

  const history = player.seasonStats.map((s) => ({
    club: s.clubStint.club,
    season: s.season,
    goals: s.goals,
    assists: s.assists,
    matches: s.matches,
    yellowCards: s.yellowCards,
    redCards: s.redCards,
    cleanSheets: s.cleanSheets,
    goalContributions: s.goals + s.assists,
  }))

  const ovrHistory = player.ovrHistory.map((h) => ({
    season: h.season,
    ovr: h.ovr,
    marketValue: h.marketValue,
  }))

  const { seasonStats: _, ovrHistory: __, ...playerData } = player
  return { ...formatPlayer(playerData), totalStats, history, ovrHistory }
}

export async function createPlayer(
  saveId: string,
  data: {
    name: string
    position: Position
    age: number
    status: PlayerStatus
    ovr: number
    potential?: number
    shirtNumber?: number
    nation?: string
    salary?: number
    marketValue?: number
    matches?: number
  }
) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: { where: { isCurrent: true } } },
  })
  if (!save) throw new NotFoundError('Save não encontrado.')

  if (data.potential !== undefined && (data.potential < 40 || data.potential > 99)) {
    throw new AppError('O campo potential deve estar entre 40 e 99.', 400)
  }

  if (data.shirtNumber !== undefined) {
    if (data.shirtNumber < 1 || data.shirtNumber > 99) {
      throw new AppError('O número de camisa deve estar entre 1 e 99.', 400)
    }
    await checkShirtNumberConflict(saveId, data.shirtNumber, null)
  }

  const currentStint = save.clubStints[0]
  const { matches, ...playerFields } = data

  const player = await prisma.$transaction(async (tx) => {
    const newPlayer = await tx.player.create({
      data: {
        saveId,
        activeClubStintId: currentStint?.id ?? null,
        ...playerFields,
      },
    })

    if (currentStint) {
      await tx.playerSeasonStats.create({
        data: {
          playerId: newPlayer.id,
          clubStintId: currentStint.id,
          season: save.currentSeason,
          matches: matches ?? 0,
        },
      })
    }

    return newPlayer
  })

  await invalidatePlayersCache(saveId)

  return formatPlayer(player)
}

export async function updatePlayer(
  saveId: string,
  playerId: string,
  data: {
    name?: string
    position?: Position
    age?: number
    status?: PlayerStatus
    ovr?: number
    potential?: number
    shirtNumber?: number
    nation?: string
    salary?: number
    marketValue?: number
    matches?: number
  }
) {
  const player = await prisma.player.findFirst({ where: { id: playerId, saveId } })
  if (!player) throw new NotFoundError('Jogador não encontrado neste save.')

  if (data.potential !== undefined && (data.potential < 40 || data.potential > 99)) {
    throw new AppError('O campo potential deve estar entre 40 e 99.', 400)
  }

  if (data.shirtNumber !== undefined) {
    if (data.shirtNumber < 1 || data.shirtNumber > 99) {
      throw new AppError('O número de camisa deve estar entre 1 e 99.', 400)
    }
    await checkShirtNumberConflict(saveId, data.shirtNumber, playerId)
  }

  const { matches, ...playerFields } = data

  const updatedPlayer = await prisma.player.update({ where: { id: playerId }, data: playerFields })

  if (matches !== undefined) {
    const save = await prisma.save.findUnique({
      where: { id: saveId },
      include: { clubStints: { where: { isCurrent: true } } },
    })
    if (save?.clubStints[0]) {
      const currentStint = save.clubStints[0]
      const stats = await prisma.playerSeasonStats.findFirst({
        where: { playerId, clubStintId: currentStint.id, season: save.currentSeason },
      })
      if (stats) {
        await prisma.playerSeasonStats.update({ where: { id: stats.id }, data: { matches } })
      }
    }
  }

  await invalidatePlayersCache(saveId, playerId)

  return formatPlayer(updatedPlayer)
}

export async function updatePlayerStats(
  saveId: string,
  playerId: string,
  data: {
    goals?: number
    assists?: number
    matches?: number
    yellowCards?: number
    redCards?: number
    cleanSheets?: number
  }
) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: { where: { isCurrent: true } } },
  })
  if (!save) throw new NotFoundError('Save não encontrado.')

  const player = await prisma.player.findFirst({ where: { id: playerId, saveId } })
  if (!player) throw new NotFoundError('Jogador não encontrado neste save.')

  const currentStint = save.clubStints[0]
  if (!currentStint) throw new NotFoundError('Nenhum clube ativo encontrado para este save.')

  if (player.activeClubStintId !== currentStint.id) {
    throw new AppError(`O jogador '${player.name}' não está no elenco ativo desta temporada.`, 400)
  }

  const stats = await prisma.playerSeasonStats.findFirst({
    where: {
      playerId,
      clubStintId: currentStint.id,
      season: save.currentSeason,
    },
  })

  if (!stats) throw new NotFoundError('Estatísticas do jogador para a temporada atual não encontradas.')

  const result = await prisma.playerSeasonStats.update({
    where: { id: stats.id },
    data,
  })

  await cacheInvalidate(
    `save:${saveId}:player:${playerId}`,
    `save:${saveId}:players:active`,
  )
  await cacheInvalidatePattern(`save:${saveId}:players:active:*`)

  return result
}

export async function releasePlayer(saveId: string, playerId: string) {
  const player = await prisma.player.findFirst({ where: { id: playerId, saveId } })
  if (!player) throw new NotFoundError('Jogador não encontrado neste save.')

  const result = await prisma.player.update({
    where: { id: playerId },
    data: { activeClubStintId: null },
  })

  await invalidatePlayersCache(saveId, playerId)

  return result
}

async function invalidatePlayersCache(saveId: string, playerId?: string) {
  const keys = [`save:${saveId}:players`, `save:${saveId}:players:active`]
  if (playerId) keys.push(`save:${saveId}:player:${playerId}`)
  await cacheInvalidate(...keys)
  await cacheInvalidatePattern(`save:${saveId}:players:active:*`)
}

async function checkShirtNumberConflict(
  saveId: string,
  shirtNumber: number,
  excludePlayerId: string | null
) {
  const conflict = await prisma.player.findFirst({
    where: {
      saveId,
      shirtNumber,
      activeClubStintId: { not: null },
      ...(excludePlayerId ? { id: { not: excludePlayerId } } : {}),
    },
  })

  if (conflict) {
    throw new AppError(
      `O número ${shirtNumber} já está em uso por ${conflict.name} no elenco atual.`,
      409,
      'SHIRT_NUMBER_CONFLICT'
    )
  }
}
