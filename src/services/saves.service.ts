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

  const { clubStints, ...rest } = save
  return {
    ...rest,
    budgetFormatted: formatBalance(rest.budget),
    balanceFormatted: formatBalance(rest.balance),
    currentClubStint: clubStints.find((cs) => cs.isCurrent) ?? null,
    clubStints,
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
        currentYear: 2026,
        currentSeason: '2026/27',
        budget: data.budget,
        balance: data.budget,
      },
    })

    const clubStint = await tx.clubStint.create({
      data: {
        saveId: newSave.id,
        club: data.club,
        startYear: '2026',
        isCurrent: true,
      },
    })

    await tx.teamSeasonStats.create({
      data: {
        clubStintId: clubStint.id,
        season: '2026/27',
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
        const trophyYear = data.currentYear ?? save.currentYear

        if (endingStats.leaguePosition === 1) {
          await tx.trophy.create({
            data: {
              clubStintId: currentStint.id,
              name: `${currentStint.club} — Campeão da Liga ${save.currentSeason}`,
              year: trophyYear,
            },
          })
        }

        if (endingStats.europeanCupResult === 'Campeao') {
          await tx.trophy.create({
            data: {
              clubStintId: currentStint.id,
              name: `${currentStint.club} — Campeão Europeu ${save.currentSeason}`,
              year: trophyYear,
            },
          })
        }

        if (endingStats.nationalCupResult === 'Campeao') {
          await tx.trophy.create({
            data: {
              clubStintId: currentStint.id,
              name: `${currentStint.club} — Campeão da Copa Nacional ${save.currentSeason}`,
              year: trophyYear,
            },
          })
        }
      }

      await tx.teamSeasonStats.create({
        data: {
          clubStintId: currentStint.id,
          season: data.currentSeason!,
        },
      })

      const activePlayers = await tx.player.findMany({
        where: { saveId, activeClubStintId: currentStint.id },
      })

      for (const player of activePlayers) {
        await tx.playerSeasonStats.create({
          data: {
            playerId: player.id,
            clubStintId: currentStint.id,
            season: data.currentSeason!,
          },
        })
      }

      // C5 — reactivate loaned players returning from loan
      const loanedPlayers = await tx.player.findMany({
        where: { saveId, status: PlayerStatus.Loan, activeClubStintId: null },
      })
      for (const player of loanedPlayers) {
        await tx.player.update({
          where: { id: player.id },
          data: { activeClubStintId: currentStint.id, status: PlayerStatus.Role },
        })
        await tx.playerSeasonStats.create({
          data: { playerId: player.id, clubStintId: currentStint.id, season: data.currentSeason! },
        })
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
