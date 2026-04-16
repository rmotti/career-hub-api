import { prisma } from '../../shared/lib/prisma.js'
import { AppError, NotFoundError } from '../../shared/utils/errors.js'
import { clubExists } from '../clubs/clubs.service.js'
import { formatBalance } from '../../shared/utils/currency.js'
import { PlayerStatus, type Save } from '@prisma/client'
import { cacheGet, cacheSet, cacheInvalidate, cacheInvalidatePattern } from '../../shared/utils/cache.js'

const TTL = {
  savesList: 60 * 15,   // 15min
  save: 60 * 30,        // 30min
}

export async function listSaves(userId: string) {
  const key = `user:${userId}:saves`
  const cached = await cacheGet<ReturnType<typeof mapSaves>>(key)
  if (cached) return cached

  const saves = await prisma.save.findMany({
    where: { userId },
    include: {
      clubStints: {
        where: { isCurrent: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const result = mapSaves(saves)
  await cacheSet(key, result, TTL.savesList)
  return result
}

function mapSaves(saves: Awaited<ReturnType<typeof prisma.save.findMany<{ include: { clubStints: true } }>>>) {
  return saves.map(({ clubStints, ...rest }) => ({
    ...rest,
    budgetFormatted: formatBalance(rest.budget),
    balanceFormatted: formatBalance(rest.balance),
    currentClubStint: clubStints[0] ?? null,
  }))
}

export async function getSaveById(saveId: string, userId: string) {
  const key = `save:${saveId}`
  const cached = await cacheGet<object>(key)
  if (cached) return cached

  const result = await fetchSaveById(saveId, userId)
  await cacheSet(key, result, TTL.save)
  return result
}

async function fetchSaveById(saveId: string, userId: string) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: { clubStints: true },
  })

  if (!save) throw new NotFoundError('Save não encontrado.')
  if (save.userId !== userId) throw new NotFoundError('Save não encontrado.')

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

export async function createSave(data: { name: string; club: string; budget: number; userId: string }) {
  if (!clubExists(data.club)) {
    throw new AppError(`Clube inválido: '${data.club}' não encontrado na lista de clubes disponíveis.`, 400)
  }

  const { newSave, clubStint } = await prisma.$transaction(async (tx) => {
    const newSave = await tx.save.create({
      data: {
        name: data.name,
        userId: data.userId,
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

    return { newSave, clubStint }
  })

  await cacheInvalidate(`user:${data.userId}:saves`)

  return {
    ...newSave,
    budgetFormatted: formatBalance(newSave.budget),
    balanceFormatted: formatBalance(newSave.balance),
    currentClubStint: clubStint,
    clubStints: [clubStint],
    availableSeasons: ['2025/26'],
  }
}

export async function updateSave(
  saveId: string,
  data: {
    currentYear?: number
    currentSeason?: string
    budget?: number
    balance?: number
  },
  userId: string
) {
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    include: {
      clubStints: {
        where: { isCurrent: true },
        include: {
          teamSeasonStats: {
            select: { season: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  })

  if (!save) throw new NotFoundError('Save não encontrado.')
  if (save.userId !== userId) throw new NotFoundError('Save não encontrado.')

  const seasonChanged = data.currentSeason && data.currentSeason !== save.currentSeason

  let txUpdatedSave: Save | null = null

  await prisma.$transaction(async (tx) => {
    if (seasonChanged && save.clubStints[0]) {
      const currentStint = save.clubStints[0]

      const endingStats = await tx.teamSeasonStats.findFirst({
        where: { clubStintId: currentStint.id, season: save.currentSeason },
      })

      if (endingStats) {
        // Always use the OLD year (the year of the season that just ended)
        const trophyYear = save.currentYear
        const leagueTrophyName = `${currentStint.club} — Campeão da Liga ${save.currentSeason}`
        const euTrophyName = `${currentStint.club} — Campeão Europeu ${save.currentSeason}`
        const cupTrophyName = `${currentStint.club} — Campeão da Copa Nacional ${save.currentSeason}`

        await Promise.all([
          endingStats.leaguePosition === 1 && tx.trophy.upsert({
            where: { clubStintId_name: { clubStintId: currentStint.id, name: leagueTrophyName } },
            create: { clubStintId: currentStint.id, name: leagueTrophyName, year: trophyYear },
            update: {},
          }),
          endingStats.europeanCupResult === 'Campeao' && tx.trophy.upsert({
            where: { clubStintId_name: { clubStintId: currentStint.id, name: euTrophyName } },
            create: { clubStintId: currentStint.id, name: euTrophyName, year: trophyYear },
            update: {},
          }),
          endingStats.nationalCupResult === 'Campeao' && tx.trophy.upsert({
            where: { clubStintId_name: { clubStintId: currentStint.id, name: cupTrophyName } },
            create: { clubStintId: currentStint.id, name: cupTrophyName, year: trophyYear },
            update: {},
          }),
        ].filter(Boolean))
      }

      const activePlayers = await tx.player.findMany({
        where: { saveId, activeClubStintId: currentStint.id },
      })

      // T3 — Step 1: snapshot OVR and marketValue before the new season starts (skip if already exists)
      if (activePlayers.length > 0) {
        await tx.playerOvrHistory.createMany({
          data: activePlayers.map((p) => ({
            playerId: p.id,
            season: save.currentSeason,
            ovr: p.ovr,
            marketValue: p.marketValue,
          })),
          skipDuplicates: true,
        })
      }

      // T2 — Step 2: increment age for all active players (max 45)
      await tx.player.updateMany({
        where: { saveId, activeClubStintId: currentStint.id, age: { lt: 45 } },
        data: { age: { increment: 1 } },
      })

      // Step 3: save update happens below via tx.save.update

      // Step 4: new TeamSeasonStats for the new season (skip if already exists)
      await tx.teamSeasonStats.upsert({
        where: { clubStintId_season: { clubStintId: currentStint.id, season: data.currentSeason! } },
        create: { clubStintId: currentStint.id, season: data.currentSeason! },
        update: {},
      })

      // Step 5: new PlayerSeasonStats for each active player (skip if already exists)
      if (activePlayers.length > 0) {
        await tx.playerSeasonStats.createMany({
          data: activePlayers.map((p) => ({
            playerId: p.id,
            clubStintId: currentStint.id,
            season: data.currentSeason!,
          })),
          skipDuplicates: true,
        })
      }

      // Step 6 (C5) — reactivate loaned players returning from loan
      const loanedPlayers = await tx.player.findMany({
        where: { saveId, status: PlayerStatus.Loan, activeClubStintId: null },
      })
      if (loanedPlayers.length > 0) {
        await tx.player.updateMany({
          where: { id: { in: loanedPlayers.map((p) => p.id) } },
          data: { activeClubStintId: currentStint.id, status: PlayerStatus.Role },
        })
        await tx.playerSeasonStats.createMany({
          data: loanedPlayers.map((p) => ({
            playerId: p.id,
            clubStintId: currentStint.id,
            season: data.currentSeason!,
          })),
          skipDuplicates: true,
        })
      }

      // C2 — reset balance to new budget when season changes
      if (data.budget !== undefined) {
        data.balance = data.budget
      }
    }

    txUpdatedSave = await tx.save.update({ where: { id: saveId }, data })
  })

  // Advance season invalida tudo do save — players envelhecem, stats mudam, troféus podem ter sido criados
  if (seasonChanged) {
    await cacheInvalidatePattern(`save:${saveId}:*`)
  }
  await cacheInvalidate(`save:${saveId}`, `user:${userId}:saves`)

  // Construir resposta inline — evita re-fetch do save (já temos os dados) e faz apenas
  // 0 queries extras para availableSeasons, reaproveitando o include inicial
  const updatedSave = txUpdatedSave!
  const currentStint = save.clubStints[0] ?? null
  const availableSeasons = seasonChanged
    ? [
        ...(currentStint?.teamSeasonStats.map((s) => s.season) ?? []),
        data.currentSeason!,
      ]
    : currentStint?.teamSeasonStats.map((s) => s.season) ?? []

  return {
    id: updatedSave.id,
    userId: updatedSave.userId,
    name: updatedSave.name,
    currentYear: updatedSave.currentYear,
    currentSeason: updatedSave.currentSeason,
    budget: updatedSave.budget,
    balance: updatedSave.balance,
    createdAt: updatedSave.createdAt,
    updatedAt: updatedSave.updatedAt,
    budgetFormatted: formatBalance(updatedSave.budget),
    balanceFormatted: formatBalance(updatedSave.balance),
    currentClubStint: currentStint,
    availableSeasons,
  }
}

export async function deleteSave(saveId: string, userId: string) {
  const save = await prisma.save.findUnique({ where: { id: saveId } })
  if (!save) throw new NotFoundError('Save não encontrado.')
  if (save.userId !== userId) throw new NotFoundError('Save não encontrado.')

  await prisma.save.delete({ where: { id: saveId } })
  await cacheInvalidatePattern(`save:${saveId}:*`)
  await cacheInvalidate(`save:${saveId}`, `user:${userId}:saves`)
}
