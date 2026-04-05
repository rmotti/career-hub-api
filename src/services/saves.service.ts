import { prisma } from '../lib/prisma'
import { AppError, NotFoundError } from '../utils/errors'
import { clubExists } from './clubs.service'
import { formatBalance } from '../utils/currency'
import { PlayerStatus } from '@prisma/client'

export async function listSaves() {
  const saves = await prisma.save.findMany({
    include: {
      clubStints: {
        where: { isCurrent: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return saves.map(({ clubStints, ...rest }) => ({
    ...rest,
    budgetFormatted: formatBalance(rest.budget),
    balanceFormatted: formatBalance(rest.balance),
    currentClubStint: clubStints[0] ?? null,
  }))
}

export async function getSaveById(saveId: string) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: true },
  })

  if (!save) throw new NotFoundError('Save não encontrado.')

  const currentStint = save.clubStints.find((cs) => cs.isCurrent) ?? null

  const teamStats = currentStint
    ? await prisma.teamSeasonStats.findMany({
        where: { clubStintId: currentStint.id },
        orderBy: { createdAt: 'asc' },
        select: { season: true },
      })
    : []

  const { clubStints, ...rest } = save
  return {
    ...rest,
    budgetFormatted: formatBalance(rest.budget),
    balanceFormatted: formatBalance(rest.balance),
    currentClubStint: currentStint,
    clubStints,
    availableSeasons: teamStats.map((s) => s.season),
  }
}

export async function createSave(data: { name: string; club: string; budget: number }) {
  if (!clubExists(data.club)) {
    throw new AppError(`Clube inválido: '${data.club}' não encontrado na lista de clubes disponíveis.`, 400)
  }

  const save = await prisma.$transaction(async (tx) => {
    const newSave = await tx.save.create({
      data: {
        name: data.name,
        currentYear: 2025,
        currentSeason: '2025/26',
        budget: data.budget,
        balance: data.budget,
      },
    })

    const clubStint = await tx.clubStint.create({
      data: {
        saveId: newSave.id,
        club: data.club,
        startYear: '2025',
        isCurrent: true,
      },
    })

    await tx.teamSeasonStats.create({
      data: {
        clubStintId: clubStint.id,
        season: '2025/26',
      },
    })

    return newSave
  })

  return getSaveById(save.id)
}

export async function updateSave(
  saveId: string,
  data: {
    currentYear?: number
    currentSeason?: string
    budget?: number
    balance?: number
  }
) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: { where: { isCurrent: true } } },
  })

  if (!save) throw new NotFoundError('Save não encontrado.')

  const seasonChanged = data.currentSeason && data.currentSeason !== save.currentSeason

  await prisma.$transaction(async (tx) => {
    if (seasonChanged && save.clubStints[0]) {
      const currentStint = save.clubStints[0]

      const endingStats = await tx.teamSeasonStats.findFirst({
        where: { clubStintId: currentStint.id, season: save.currentSeason },
      })

      if (endingStats) {
        // Always use the OLD year (the year of the season that just ended)
        const trophyYear = save.currentYear

        if (endingStats.leaguePosition === 1) {
          const leagueTrophyName = `${currentStint.club} — Campeão da Liga ${save.currentSeason}`
          const exists = await tx.trophy.findFirst({
            where: { clubStintId: currentStint.id, name: leagueTrophyName },
          })
          if (!exists) {
            await tx.trophy.create({
              data: { clubStintId: currentStint.id, name: leagueTrophyName, year: trophyYear },
            })
          }
        }

        if (endingStats.europeanCupResult === 'Campeao') {
          const euTrophyName = `${currentStint.club} — Campeão Europeu ${save.currentSeason}`
          const exists = await tx.trophy.findFirst({
            where: { clubStintId: currentStint.id, name: euTrophyName },
          })
          if (!exists) {
            await tx.trophy.create({
              data: { clubStintId: currentStint.id, name: euTrophyName, year: trophyYear },
            })
          }
        }

        if (endingStats.nationalCupResult === 'Campeao') {
          const cupTrophyName = `${currentStint.club} — Campeão da Copa Nacional ${save.currentSeason}`
          const exists = await tx.trophy.findFirst({
            where: { clubStintId: currentStint.id, name: cupTrophyName },
          })
          if (!exists) {
            await tx.trophy.create({
              data: { clubStintId: currentStint.id, name: cupTrophyName, year: trophyYear },
            })
          }
        }
      }

      const activePlayers = await tx.player.findMany({
        where: { saveId, activeClubStintId: currentStint.id },
      })

      // T3 — Step 1: snapshot OVR and marketValue before the new season starts (skip if already exists)
      const existingSnapshots = await tx.playerOvrHistory.findMany({
        where: { season: save.currentSeason, playerId: { in: activePlayers.map((p) => p.id) } },
        select: { playerId: true },
      })
      const snappedPlayerIds = new Set(existingSnapshots.map((s) => s.playerId))
      const newSnapshots = activePlayers.filter((p) => !snappedPlayerIds.has(p.id))
      if (newSnapshots.length > 0) {
        await tx.playerOvrHistory.createMany({
          data: newSnapshots.map((p) => ({
            playerId: p.id,
            season: save.currentSeason,
            ovr: p.ovr,
            marketValue: p.marketValue,
          })),
        })
      }

      // T2 — Step 2: increment age for all active players (max 45)
      await tx.player.updateMany({
        where: { saveId, activeClubStintId: currentStint.id, age: { lt: 45 } },
        data: { age: { increment: 1 } },
      })

      // Step 3: save update happens below via tx.save.update

      // Step 4: new TeamSeasonStats for the new season (skip if already exists)
      const existingTeamStats = await tx.teamSeasonStats.findFirst({
        where: { clubStintId: currentStint.id, season: data.currentSeason! },
      })
      if (!existingTeamStats) {
        await tx.teamSeasonStats.create({
          data: { clubStintId: currentStint.id, season: data.currentSeason! },
        })
      }

      // Step 5: new PlayerSeasonStats for each active player (skip if already exists)
      const existingPlayerStats = await tx.playerSeasonStats.findMany({
        where: { clubStintId: currentStint.id, season: data.currentSeason!, playerId: { in: activePlayers.map((p) => p.id) } },
        select: { playerId: true },
      })
      const existingPlayerIds = new Set(existingPlayerStats.map((s) => s.playerId))
      for (const player of activePlayers) {
        if (!existingPlayerIds.has(player.id)) {
          await tx.playerSeasonStats.create({
            data: { playerId: player.id, clubStintId: currentStint.id, season: data.currentSeason! },
          })
        }
      }

      // Step 6 (C5) — reactivate loaned players returning from loan
      const loanedPlayers = await tx.player.findMany({
        where: { saveId, status: PlayerStatus.Loan, activeClubStintId: null },
      })
      for (const player of loanedPlayers) {
        await tx.player.update({
          where: { id: player.id },
          data: { activeClubStintId: currentStint.id, status: PlayerStatus.Role },
        })
        const loanedStatsExist = await tx.playerSeasonStats.findFirst({
          where: { playerId: player.id, clubStintId: currentStint.id, season: data.currentSeason! },
        })
        if (!loanedStatsExist) {
          await tx.playerSeasonStats.create({
            data: { playerId: player.id, clubStintId: currentStint.id, season: data.currentSeason! },
          })
        }
      }

      // C2 — reset balance to new budget when season changes
      if (data.budget !== undefined) {
        data.balance = data.budget
      }
    }

    await tx.save.update({ where: { id: saveId }, data })
  })

  return getSaveById(saveId)
}

export async function deleteSave(saveId: string) {
  const save = await prisma.save.findUnique({ where: { id: saveId } })
  if (!save) throw new NotFoundError('Save não encontrado.')

  await prisma.save.delete({ where: { id: saveId } })
}
