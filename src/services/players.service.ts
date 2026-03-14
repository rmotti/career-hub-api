import { prisma } from '../lib/prisma'
import { NotFoundError } from '../utils/errors'
import { Position, PlayerStatus } from '@prisma/client'

export async function listPlayers(saveId: string, activeOnly?: boolean) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: { where: { isCurrent: true } } },
  })
  if (!save) throw new NotFoundError('Save not found')

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

    return players.map((p) => ({
      ...p,
      currentSeasonStats: p.seasonStats[0] ?? null,
      seasonStats: undefined,
    }))
  }

  const players = await prisma.player.findMany({
    where: { saveId },
    include: { seasonStats: true },
  })

  return players.map((p) => {
    const totalStats = p.seasonStats.reduce(
      (acc, s) => ({
        goals: acc.goals + s.goals,
        assists: acc.assists + s.assists,
        yellowCards: acc.yellowCards + s.yellowCards,
        redCards: acc.redCards + s.redCards,
      }),
      { goals: 0, assists: 0, yellowCards: 0, redCards: 0 }
    )
    return { ...p, totalStats, seasonStats: undefined }
  })
}

export async function getPlayerById(saveId: string, playerId: string) {
  const save = await prisma.save.findUnique({ where: { id: saveId } })
  if (!save) throw new NotFoundError('Save not found')

  const player = await prisma.player.findFirst({
    where: { id: playerId, saveId },
    include: {
      seasonStats: {
        include: { clubStint: true },
      },
    },
  })

  if (!player) throw new NotFoundError('Player not found')

  const totalStats = player.seasonStats.reduce(
    (acc, s) => ({
      goals: acc.goals + s.goals,
      assists: acc.assists + s.assists,
      yellowCards: acc.yellowCards + s.yellowCards,
      redCards: acc.redCards + s.redCards,
    }),
    { goals: 0, assists: 0, yellowCards: 0, redCards: 0 }
  )

  const history = player.seasonStats.map((s) => ({
    club: s.clubStint.club,
    season: s.season,
    goals: s.goals,
    assists: s.assists,
    yellowCards: s.yellowCards,
    redCards: s.redCards,
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
  }
) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: { where: { isCurrent: true } } },
  })
  if (!save) throw new NotFoundError('Save not found')

  const currentStint = save.clubStints[0]

  const player = await prisma.$transaction(async (tx) => {
    const newPlayer = await tx.player.create({
      data: {
        saveId,
        activeClubStintId: currentStint?.id ?? null,
        ...data,
      },
    })

    if (currentStint) {
      await tx.playerSeasonStats.create({
        data: {
          playerId: newPlayer.id,
          clubStintId: currentStint.id,
          season: save.currentSeason,
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
  }
) {
  const player = await prisma.player.findFirst({ where: { id: playerId, saveId } })
  if (!player) throw new NotFoundError('Player not found')

  return prisma.player.update({ where: { id: playerId }, data })
}

export async function updatePlayerStats(
  saveId: string,
  playerId: string,
  data: {
    goals?: number
    assists?: number
    yellowCards?: number
    redCards?: number
  }
) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: { where: { isCurrent: true } } },
  })
  if (!save) throw new NotFoundError('Save not found')

  const player = await prisma.player.findFirst({ where: { id: playerId, saveId } })
  if (!player) throw new NotFoundError('Player not found')

  const currentStint = save.clubStints[0]
  if (!currentStint) throw new NotFoundError('No current club stint')

  const stats = await prisma.playerSeasonStats.findFirst({
    where: {
      playerId,
      clubStintId: currentStint.id,
      season: save.currentSeason,
    },
  })

  if (!stats) throw new NotFoundError('Player season stats not found for current season')

  return prisma.playerSeasonStats.update({
    where: { id: stats.id },
    data,
  })
}

export async function releasePlayer(saveId: string, playerId: string) {
  const player = await prisma.player.findFirst({ where: { id: playerId, saveId } })
  if (!player) throw new NotFoundError('Player not found')

  return prisma.player.update({
    where: { id: playerId },
    data: { activeClubStintId: null },
  })
}
