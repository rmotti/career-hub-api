import { prisma } from '../lib/prisma'
import { AppError, NotFoundError } from '../utils/errors'
import { isValidCurrencyFormat, formatCurrency } from '../utils/currency'
import { Position, PlayerStatus } from '@prisma/client'

function normalizeCurrency(value: string | number | undefined, fieldName: 'salary' | 'marketValue'): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number') return formatCurrency(value)
  if (!isValidCurrencyFormat(value)) {
    if (fieldName === 'salary') {
      throw new AppError('Formato de salário inválido. Use o formato €XK ou €XM (ex: €75K).', 400)
    }
    throw new AppError('Formato de valor de mercado inválido. Use o formato €XK ou €XM (ex: €35M).', 400)
  }
  return value
}

export async function listPlayers(saveId: string, activeOnly?: boolean) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: { where: { isCurrent: true } } },
  })
  if (!save) throw new NotFoundError('Save não encontrado.')

  if (activeOnly) {
    const currentStint = save.clubStints[0]
    if (!currentStint) return []

    const players = await prisma.player.findMany({
      where: { saveId, activeClubStintId: currentStint.id },
      include: {
        seasonStats: {
          where: {
            clubStintId: currentStint.id,
            season: save.currentSeason,
          },
        },
      },
    })

    return players.map((p) => {
      const s = p.seasonStats[0] ?? null
      return {
        ...p,
        currentSeasonStats: s ? { ...s, goalContributions: s.goals + s.assists } : null,
        seasonStats: undefined,
      }
    })
  }

  const players = await prisma.player.findMany({
    where: { saveId },
    include: { seasonStats: true },
  })

  return players.map((p) => {
    const totals = p.seasonStats.reduce(
      (acc, s) => ({
        goals: acc.goals + s.goals,
        assists: acc.assists + s.assists,
        matches: acc.matches + s.matches,
        yellowCards: acc.yellowCards + s.yellowCards,
        redCards: acc.redCards + s.redCards,
      }),
      { goals: 0, assists: 0, matches: 0, yellowCards: 0, redCards: 0 }
    )
    return { ...p, totalStats: { ...totals, goalContributions: totals.goals + totals.assists }, seasonStats: undefined }
  })
}

export async function getPlayerById(saveId: string, playerId: string) {
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
    }),
    { goals: 0, assists: 0, matches: 0, yellowCards: 0, redCards: 0 }
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
    goalContributions: s.goals + s.assists,
  }))

  const { seasonStats: _, ...playerData } = player
  return { ...playerData, totalStats, history }
}

export async function createPlayer(
  saveId: string,
  data: {
    name: string
    position: Position
    age: number
    status: PlayerStatus
    ovr: number
    salary?: string
    marketValue?: string
    matches?: number
  }
) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: { where: { isCurrent: true } } },
  })
  if (!save) throw new NotFoundError('Save não encontrado.')

  const currentStint = save.clubStints[0]

  const { matches, ...playerFields } = data
  const normalizedData = {
    ...playerFields,
    salary: normalizeCurrency(playerFields.salary, 'salary'),
    marketValue: normalizeCurrency(playerFields.marketValue, 'marketValue'),
  }

  const player = await prisma.$transaction(async (tx) => {
    const newPlayer = await tx.player.create({
      data: {
        saveId,
        activeClubStintId: currentStint?.id ?? null,
        ...normalizedData,
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

  return player
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
    salary?: string
    marketValue?: string
    activeClubStintId?: string | null
    matches?: number
  }
) {
  const player = await prisma.player.findFirst({ where: { id: playerId, saveId } })
  if (!player) throw new NotFoundError('Jogador não encontrado neste save.')

  const { matches, ...playerFields } = data
  const normalizedData = {
    ...playerFields,
    salary: normalizeCurrency(playerFields.salary, 'salary'),
    marketValue: normalizeCurrency(playerFields.marketValue, 'marketValue'),
  }

  const updatedPlayer = await prisma.player.update({ where: { id: playerId }, data: normalizedData })

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

  return updatedPlayer
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

  return prisma.playerSeasonStats.update({
    where: { id: stats.id },
    data,
  })
}

export async function releasePlayer(saveId: string, playerId: string) {
  const player = await prisma.player.findFirst({ where: { id: playerId, saveId } })
  if (!player) throw new NotFoundError('Jogador não encontrado neste save.')

  return prisma.player.update({
    where: { id: playerId },
    data: { activeClubStintId: null },
  })
}
