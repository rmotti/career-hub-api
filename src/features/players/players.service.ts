import { prisma } from '../../shared/lib/prisma.js'
import { NotFoundError, AppError } from '../../shared/utils/errors.js'
import { formatMarketValue, formatSalary, millions, thousands } from '../../shared/utils/currency.js'
import { Position, PlayerStatus, TransferType } from '@prisma/client'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { cacheGet, cacheSet, cacheInvalidate, cacheInvalidatePattern } from '../../shared/utils/cache.js'
import { createSnapshot, writeAudit } from '../saves/snapshots.service.js'

const TTL = {
  playersList: 60 * 60,        // 1h
  playersActive: 60 * 30,      // 30min
  player: 60 * 60,             // 1h
}

const POSITION_ORDER: Position[] = [
  'GOL', 'LD', 'LE', 'ZAG', 'VOL', 'MC', 'ME', 'MD', 'MEI', 'PE', 'PD', 'SA', 'ATA',
]

const POSITION_VALUES = new Set<Position>(POSITION_ORDER)

type AlternativePositionInput = {
  positions: Position[]
}

function formatPlayer<T extends { marketValue: number | null; salary: number | null }>(p: T) {
  return {
    ...p,
    marketValueFormatted: formatMarketValue(millions(p.marketValue)),
    salaryFormatted: formatSalary(thousands(p.salary)),
  }
}

export async function listPlayers(saveId: string, activeOnly?: boolean, season?: string, loaned?: boolean) {
  let cacheKey: string
  let ttl: number

  if (loaned) {
    cacheKey = `save:${saveId}:players:loaned`
    ttl = TTL.playersActive
  } else if (activeOnly) {
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

  const result = loaned ? await fetchLoanedPlayers(saveId) : await fetchPlayers(saveId, activeOnly, season)
  await cacheSet(cacheKey, result, ttl)
  return result
}

async function fetchPlayers(saveId: string, activeOnly?: boolean, season?: string) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    select: {
      currentSeason: true,
      clubStints: {
        where: { isCurrent: true },
        select: { id: true, club: true },
      },
    },
  })
  if (!save) throw new NotFoundError('Save não encontrado.')

  if (activeOnly) {
    const currentStint = save.clubStints[0]
    if (!currentStint) return []

    const isCurrentSeason = !season || season === save.currentSeason

    if (isCurrentSeason) {
      // Fetch active players and season stats in parallel — both only need currentStint.id
      const [activePlayers, seasonStatsRows] = await Promise.all([
        prisma.player.findMany({
          where: { saveId, activeClubStintId: currentStint.id },
        }),
        prisma.playerSeasonStats.findMany({
          where: { clubStintId: currentStint.id, season: save.currentSeason },
        }),
      ])
      const playerIds = activePlayers.map(p => p.id)

      const ovrHistoryRows = await prisma.playerOvrHistory.findMany({
        where: { playerId: { in: playerIds } },
        orderBy: { createdAt: 'desc' },
      })

      // Latest OVR entry per player (already ordered by createdAt desc)
      const lastOvrMap = new Map<string, typeof ovrHistoryRows[number]>()
      for (const h of ovrHistoryRows) {
        if (!lastOvrMap.has(h.playerId)) lastOvrMap.set(h.playerId, h)
      }

      const statsMap = new Map(seasonStatsRows.map(s => [s.playerId, s]))

      const sorted = [...activePlayers].sort(
        (a, b) => POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position)
      )

      return sorted.map((p) => {
        const s = statsMap.get(p.id) ?? null
        const lastHistory = lastOvrMap.get(p.id) ?? null
        const stats = s
          ? { ...s, goalContributions: s.goals + s.assists }
          : { goals: 0, assists: 0, matches: 0, yellowCards: 0, redCards: 0, cleanSheets: 0, goalContributions: 0 }
        return {
          ...formatPlayer(p),
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

  const [players, statsTotals] = await Promise.all([
    prisma.player.findMany({
      where: { saveId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.playerSeasonStats.groupBy({
      by: ['playerId'],
      where: { player: { saveId } },
      _sum: {
        goals: true,
        assists: true,
        matches: true,
        yellowCards: true,
        redCards: true,
        cleanSheets: true,
      },
    }),
  ])

  const totalsMap = new Map(statsTotals.map((s) => [s.playerId, s._sum]))

  return players.map((p) => {
    const t = totalsMap.get(p.id)
    const goals = t?.goals ?? 0
    const assists = t?.assists ?? 0
    return {
      ...formatPlayer(p),
      totalStats: {
        goals,
        assists,
        matches: t?.matches ?? 0,
        yellowCards: t?.yellowCards ?? 0,
        redCards: t?.redCards ?? 0,
        cleanSheets: t?.cleanSheets ?? 0,
        goalContributions: goals + assists,
      },
    }
  })
}

async function fetchLoanedPlayers(saveId: string) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    select: {
      currentSeason: true,
      clubStints: {
        where: { isCurrent: true },
        select: { id: true, club: true },
      },
    },
  })
  if (!save) throw new NotFoundError('Save não encontrado.')

  const currentStint = save.clubStints[0]
  if (!currentStint) return []

  const loanedPlayers = await prisma.player.findMany({
    where: {
      saveId,
      status: PlayerStatus.Loan,
      activeClubStintId: null,
      transfers: {
        some: {
          type: 'emprestimo_saida',
          clubStintId: currentStint.id,
        },
      },
    },
    include: {
      transfers: {
        where: { type: 'emprestimo_saida', clubStintId: currentStint.id },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { to: true, season: true },
      },
    },
  })

  if (loanedPlayers.length === 0) return []

  const playerIds = loanedPlayers.map(p => p.id)

  const [seasonStatsRows, ovrHistoryRows] = await Promise.all([
    prisma.playerSeasonStats.findMany({
      where: { clubStintId: currentStint.id, season: save.currentSeason, playerId: { in: playerIds } },
    }),
    prisma.playerOvrHistory.findMany({
      where: { playerId: { in: playerIds } },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const statsMap = new Map(seasonStatsRows.map(s => [s.playerId, s]))

  const lastOvrMap = new Map<string, typeof ovrHistoryRows[number]>()
  for (const h of ovrHistoryRows) {
    if (!lastOvrMap.has(h.playerId)) lastOvrMap.set(h.playerId, h)
  }

  const sorted = [...loanedPlayers].sort(
    (a, b) => POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position)
  )

  return sorted.map(({ transfers, ...p }) => {
    const s = statsMap.get(p.id) ?? null
    const lastHistory = lastOvrMap.get(p.id) ?? null
    const loanTransfer = transfers[0] ?? null
    const stats = s
      ? { ...s, goalContributions: s.goals + s.assists }
      : { goals: 0, assists: 0, matches: 0, yellowCards: 0, redCards: 0, cleanSheets: 0, goalContributions: 0 }
    return {
      ...formatPlayer(p),
      currentSeasonStats: stats,
      ovrDelta: lastHistory !== null ? p.ovr - lastHistory.ovr : null,
      marketValueDelta: (lastHistory !== null && p.marketValue !== null && lastHistory.marketValue !== null)
        ? p.marketValue - lastHistory.marketValue
        : null,
      loanedTo: loanTransfer?.to ?? null,
      loanSeason: loanTransfer?.season ?? null,
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
  const [save, player] = await Promise.all([
    prisma.save.findUnique({ where: { id: saveId } }),
    prisma.player.findFirst({
      where: { id: playerId, saveId },
      include: {
        seasonStats: {
          select: {
            season: true,
            goals: true,
            assists: true,
            matches: true,
            yellowCards: true,
            redCards: true,
            cleanSheets: true,
            clubStint: { select: { club: true } },
          },
        },
        ovrHistory: {
          orderBy: { createdAt: 'asc' },
          take: 20,
          select: { season: true, ovr: true, marketValue: true },
        },
      },
    }),
  ])

  if (!save) throw new NotFoundError('Save não encontrado.')
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
    alternativePosition?: AlternativePositionInput
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
  const { matches, alternativePosition, ...playerFields } = data
  const normalizedAlternativePosition = alternativePosition !== undefined
    ? validateAlternativePosition(alternativePosition, data.position)
    : undefined

  const player = await prisma.$transaction(async (tx) => {
    const newPlayer = await tx.player.create({
      data: {
        saveId,
        activeClubStintId: currentStint?.id ?? null,
        ...playerFields,
        ...(normalizedAlternativePosition !== undefined && { alternativePosition: normalizedAlternativePosition }),
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
    alternativePosition?: AlternativePositionInput
    salary?: number
    marketValue?: number
    matches?: number
  }
) {
  const { matches, alternativePosition, ...playerFields } = data

  const [player, saveWithStint] = await Promise.all([
    prisma.player.findFirst({ where: { id: playerId, saveId } }),
    matches !== undefined
      ? prisma.save.findUnique({ where: { id: saveId }, include: { clubStints: { where: { isCurrent: true } } } })
      : Promise.resolve(null),
  ])

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

  const primaryPosition = data.position ?? player.position
  const normalizedAlternativePosition = alternativePosition !== undefined
    ? validateAlternativePosition(alternativePosition, primaryPosition)
    : data.position !== undefined
      ? validateAlternativePosition(player.alternativePosition, primaryPosition)
      : undefined

  const updatedPlayer = await prisma.player.update({
    where: { id: playerId },
    data: {
      ...playerFields,
      ...(normalizedAlternativePosition !== undefined && alternativePosition !== undefined && {
        alternativePosition: normalizedAlternativePosition,
      }),
    },
  })

  if (matches !== undefined && saveWithStint?.clubStints[0]) {
    const currentStint = saveWithStint.clubStints[0]
    await prisma.playerSeasonStats.update({
      where: {
        playerId_clubStintId_season: {
          playerId,
          clubStintId: currentStint.id,
          season: saveWithStint.currentSeason,
        },
      },
      data: { matches },
    }).catch((e) => {
      if (!(e instanceof PrismaClientKnownRequestError && e.code === 'P2025')) throw e
    })
  }

  await invalidatePlayersCache(saveId)

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
  const [save, player] = await Promise.all([
    prisma.save.findUnique({
      where: { id: saveId },
      include: { clubStints: { where: { isCurrent: true } } },
    }),
    prisma.player.findFirst({ where: { id: playerId, saveId } }),
  ])
  if (!save) throw new NotFoundError('Save não encontrado.')
  if (!player) throw new NotFoundError('Jogador não encontrado neste save.')

  const currentStint = save.clubStints[0]
  if (!currentStint) throw new NotFoundError('Nenhum clube ativo encontrado para este save.')

  if (player.activeClubStintId !== currentStint.id) {
    throw new AppError(`O jogador '${player.name}' não está no elenco ativo desta temporada.`, 400)
  }

  let updated
  try {
    updated = await prisma.playerSeasonStats.update({
      where: {
        playerId_clubStintId_season: {
          playerId,
          clubStintId: currentStint.id,
          season: save.currentSeason,
        },
      },
      data,
      select: {
        id: true,
        playerId: true,
        season: true,
        goals: true,
        assists: true,
        matches: true,
        yellowCards: true,
        redCards: true,
        cleanSheets: true,
      },
    })
  } catch (e) {
    if (e instanceof PrismaClientKnownRequestError && e.code === 'P2025') {
      throw new NotFoundError('Estatísticas do jogador para a temporada atual não encontradas.')
    }
    throw e
  }

  // Hot path (editing current-season stats): exact-key invalidation, no SCAN.
  // Only the current season changes; `players` is included because the full list
  // aggregates each player's totals across all seasons. Historical seasons
  // and `players:loaned` are unaffected (the player is in the active squad).
  await cacheInvalidate(
    `save:${saveId}:player:${playerId}`,
    `save:${saveId}:players`,
    `save:${saveId}:players:active`,
    `save:${saveId}:players:active:${updated.season}`,
  )

  return {
    ...updated,
    goalContributions: updated.goals + updated.assists,
  }
}

export async function importFc26Squad(saveId: string, userId: string) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: { where: { isCurrent: true } } },
  })
  if (!save) throw new NotFoundError('Save não encontrado.')

  const currentStint = save.clubStints[0]
  if (!currentStint) {
    throw new AppError('Nenhum clube ativo neste save.', 400)
  }

  const fc26Players = await prisma.fc26Player.findMany({
    where: { club: currentStint.club },
  })

  if (fc26Players.length === 0) {
    throw new NotFoundError(
      `Nenhum jogador encontrado no dataset FC26 para o clube '${currentStint.club}'.`
    )
  }

  const existing = await prisma.player.findMany({
    where: { saveId },
    select: { name: true },
  })
  const existingNames = new Set(existing.map((p) => p.name))

  const toImport = fc26Players.filter((p) => !existingNames.has(p.name))
  const skipped = fc26Players.length - toImport.length

  if (toImport.length === 0) {
    return { imported: 0, skipped, total: fc26Players.length }
  }

  await prisma.$transaction(async (tx) => {
    // Bulk import (creates dozens of players): safety snapshot + audit before,
    // for an "undo import" via the snapshot restore.
    await createSnapshot(tx, saveId, userId, 'pre-fc26-import')
    await writeAudit(tx, {
      userId,
      saveId,
      action: 'squad.import',
      meta: { club: currentStint.club, importing: toImport.length, skipped },
    })

    for (const fc of toImport) {
      const primary = fc.positions[0] as Position
      if (!POSITION_VALUES.has(primary)) continue

      const altSet = new Set<Position>()
      for (const p of fc.positions.slice(1)) {
        if (POSITION_VALUES.has(p as Position) && p !== primary) {
          altSet.add(p as Position)
        }
      }

      const created = await tx.player.create({
        data: {
          saveId,
          activeClubStintId: currentStint.id,
          name: fc.name,
          position: primary,
          age: fc.age,
          status: PlayerStatus.Important,
          ovr: fc.ovr,
          potential: fc.potential,
          nation: fc.nation,
          marketValue: fc.marketValue,
          salary: fc.wage,
          alternativePosition: { positions: [...altSet] },
        },
      })

      await tx.playerSeasonStats.create({
        data: {
          playerId: created.id,
          clubStintId: currentStint.id,
          season: save.currentSeason,
        },
      })
    }
  })

  await invalidatePlayersCache(saveId)

  return { imported: toImport.length, skipped, total: fc26Players.length }
}

export async function releasePlayer(saveId: string, playerId: string, userId: string) {
  const player = await prisma.player.findFirst({ where: { id: playerId, saveId } })
  if (!player) throw new NotFoundError('Jogador não encontrado neste save.')

  // Releasing removes the player from the squad (destructive): safety snapshot + audit before,
  // so it can be reverted via the save restore. `fromClubStintId` stays in the audit for tracing.
  const result = await prisma.$transaction(async (tx) => {
    await createSnapshot(tx, saveId, userId, 'pre-player-release')
    await writeAudit(tx, {
      userId,
      saveId,
      action: 'player.release',
      meta: { playerId, playerName: player.name, fromClubStintId: player.activeClubStintId },
    })
    return tx.player.update({
      where: { id: playerId },
      data: { activeClubStintId: null },
    })
  })

  await invalidatePlayersCache(saveId)

  return formatPlayer(result)
}

/**
 * Recalls a player who is out on loan (#4.2 F-002): ends the loan early and
 * re-attaches him to the current club's squad mid-season, instead of waiting
 * for the next season advance to auto-return him.
 */
export async function recallLoanedPlayer(saveId: string, playerId: string, userId: string) {
  const [save, player] = await Promise.all([
    prisma.save.findUnique({
      where: { id: saveId },
      include: { clubStints: { where: { isCurrent: true }, select: { id: true } } },
    }),
    prisma.player.findFirst({ where: { id: playerId, saveId } }),
  ])
  if (!save) throw new NotFoundError('Save não encontrado.')
  if (!player) throw new NotFoundError('Jogador não encontrado neste save.')

  const currentStint = save.clubStints[0]
  if (!currentStint) throw new NotFoundError('Nenhum clube ativo encontrado para este save.')

  // Must actually be out on loan from the current club.
  if (player.status !== PlayerStatus.Loan || player.activeClubStintId !== null) {
    throw new AppError(`O jogador '${player.name}' não está emprestado.`, 400)
  }
  const loanTransfer = await prisma.transfer.findFirst({
    where: { saveId, playerId, type: TransferType.emprestimo_saida, clubStintId: currentStint.id },
  })
  if (!loanTransfer) {
    throw new AppError(`O jogador '${player.name}' não foi emprestado pelo clube atual.`, 400)
  }

  // Recall = end the loan early and bring him back to the squad now. Age is NOT
  // touched (it advances only on a season advance — decided 2026-06-19). After
  // this, the season-advance loan-return pass naturally skips him (he is no
  // longer status=Loan + activeClubStintId=null), so there is no double-return;
  // explicit loan-end metadata on the Transfer comes with #4.4 B-002.
  const result = await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      userId,
      saveId,
      action: 'player.loan_recall',
      meta: { playerId, playerName: player.name, loanTransferId: loanTransfer.id, toStintId: currentStint.id },
    })
    const updated = await tx.player.update({
      where: { id: playerId },
      data: { activeClubStintId: currentStint.id, status: PlayerStatus.Role },
    })
    // Ensure he can accrue stats for the remainder of the current season.
    await tx.playerSeasonStats.createMany({
      data: [{ playerId, clubStintId: currentStint.id, season: save.currentSeason }],
      skipDuplicates: true,
    })
    return updated
  })

  await invalidatePlayersCache(saveId)

  return formatPlayer(result)
}

/**
 * Loan-spell stats (#4.4 B-001): goals/assists/matches a player recorded while OUT
 * ON LOAN. Informational only — they live in their own table and are NEVER summed
 * into career history, History-tab records/rankings, or club totals.
 */
export async function getLoanSpellStats(saveId: string, playerId: string) {
  const cacheKey = `save:${saveId}:player:${playerId}:loan-stats`
  const cached = await cacheGet<unknown>(cacheKey)
  if (cached) return cached

  const player = await prisma.player.findFirst({ where: { id: playerId, saveId }, select: { id: true } })
  if (!player) throw new NotFoundError('Jogador não encontrado neste save.')

  const rows = await prisma.loanSpellStats.findMany({
    where: { saveId, playerId },
    orderBy: { season: 'asc' },
  })
  const result = rows.map((r) => ({ ...r, goalContributions: r.goals + r.assists }))
  await cacheSet(cacheKey, result, TTL.player)
  return result
}

/** Upserts the current loan season's stats. Only allowed while the player is out on loan. */
export async function upsertLoanSpellStats(
  saveId: string,
  playerId: string,
  data: { goals?: number; assists?: number; matches?: number }
) {
  const [save, player] = await Promise.all([
    prisma.save.findUnique({
      where: { id: saveId },
      include: { clubStints: { where: { isCurrent: true }, select: { id: true } } },
    }),
    prisma.player.findFirst({ where: { id: playerId, saveId } }),
  ])
  if (!save) throw new NotFoundError('Save não encontrado.')
  if (!player) throw new NotFoundError('Jogador não encontrado neste save.')

  const currentStint = save.clubStints[0]
  if (!currentStint) throw new NotFoundError('Nenhum clube ativo encontrado para este save.')

  if (player.status !== PlayerStatus.Loan || player.activeClubStintId !== null) {
    throw new AppError(`O jogador '${player.name}' não está emprestado; estatísticas de empréstimo só podem ser editadas enquanto ele está cedido.`, 400)
  }
  const loanTransfer = await prisma.transfer.findFirst({
    where: { saveId, playerId, type: TransferType.emprestimo_saida, clubStintId: currentStint.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, to: true },
  })
  if (!loanTransfer) {
    throw new AppError(`O jogador '${player.name}' não foi emprestado pelo clube atual.`, 400)
  }

  const row = await prisma.loanSpellStats.upsert({
    where: { playerId_season: { playerId, season: save.currentSeason } },
    create: {
      saveId,
      playerId,
      transferId: loanTransfer.id,
      loanClub: loanTransfer.to,
      season: save.currentSeason,
      ...data,
    },
    update: data,
  })

  await cacheInvalidate(`save:${saveId}:player:${playerId}:loan-stats`)
  return { ...row, goalContributions: row.goals + row.assists }
}

/**
 * Invalidates ALL of a save's player cache keys at once:
 * `players`, `players:active`, `players:active:<season>` (any historical
 * season), `players:loaned` and `player:<id>`. They all start with the prefix
 * `save:<id>:player`, so a single pattern covers the whole set — including
 * the per-season keys that can't be enumerated without knowing the seasons.
 * Exported so the squad-mutating services (transfers, club-stints) use
 * the same source of truth instead of hand-listing keys (and forgetting one).
 */
export async function invalidatePlayersCache(saveId: string) {
  await cacheInvalidatePattern(`save:${saveId}:player*`)
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

function validateAlternativePosition(value: unknown, primaryPosition: Position): AlternativePositionInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('O campo alternativePosition deve ser um objeto com a propriedade positions.', 400)
  }

  const positions = (value as { positions?: unknown }).positions
  if (!Array.isArray(positions)) {
    throw new AppError('O campo alternativePosition.positions deve ser uma lista.', 400)
  }

  const seen = new Set<Position>()
  for (const position of positions) {
    if (typeof position !== 'string' || !POSITION_VALUES.has(position as Position)) {
      throw new AppError(`Posição alternativa inválida: '${String(position)}'.`, 400)
    }

    if (position === primaryPosition) {
      throw new AppError('alternativePosition.positions não deve repetir a posição principal do jogador.', 400)
    }

    if (seen.has(position as Position)) {
      throw new AppError(`Posição alternativa duplicada: '${position}'.`, 400)
    }

    seen.add(position as Position)
  }

  return { positions: [...seen] }
}
