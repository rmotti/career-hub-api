import { prisma } from '../../shared/lib/prisma.js'
import { cacheGet, cacheSet } from '../../shared/utils/cache.js'
import { formatBalance, formatSalary, millions, thousands } from '../../shared/utils/currency.js'

const TTL = 300

/**
 * Builds the dense save briefing (club, season, finances, top 5, current-season results) as a
 * JSON string, cached in Redis. Shared by the MCP `save://{saveId}/dossier` resource and the
 * chat first-turn auto-context. Returns null when the save doesn't exist or isn't owned by the
 * user (caller decides whether that's an error or a no-op). Validates ownership via `userId`.
 *
 * Deliberately carries NO formation gaps: the save has no stored formation, so any gap read here
 * would assume a shape (4-3-3) the user never confirmed — and the opening message would then
 * always parrot that shape's gaps (e.g. a phantom left-back hole for a back-three side). Gaps are
 * computed on demand by the scouting tools once the user states their formation.
 *
 * v3: dropped the gaps block (was v2). Bumping the key avoids serving a stale pre-deploy entry
 * for up to TTL after the format switch.
 */
export async function getSaveDossierJson(userId: string, saveId: string): Promise<string | null> {
  const cacheKey = `mcp:resource:dossier:v3:${userId}:${saveId}`
  const cached = await cacheGet<string>(cacheKey)
  if (cached) return cached

  const save = await prisma.save.findFirst({
    where: { id: saveId, userId },
    include: { clubStints: { where: { isCurrent: true }, take: 1 } },
  })
  if (!save) return null

  const stint = save.clubStints[0]

  const [topPlayers, wageAgg, lastTeamStats] = await Promise.all([
    stint
      ? prisma.player.findMany({
          where: { saveId: save.id, activeClubStintId: stint.id },
          orderBy: { ovr: 'desc' },
          take: 5,
          select: { name: true, position: true, age: true, ovr: true, potential: true, status: true },
        })
      : Promise.resolve([]),
    stint
      ? prisma.player.aggregate({
          where: { saveId: save.id, activeClubStintId: stint.id },
          _sum: { salary: true },
          _count: true,
        })
      : Promise.resolve(null),
    stint
      ? prisma.teamSeasonStats.findMany({
          where: { clubStintId: stint.id, season: save.currentSeason },
          include: { competition: { select: { name: true, type: true } } },
        })
      : Promise.resolve([]),
  ])

  const payload = {
    save: save.name,
    club: stint?.club ?? null,
    season: save.currentSeason,
    year: save.currentYear,
    finances: {
      transferBudget: formatBalance(millions(save.budget)),
      clubBalance: formatBalance(millions(save.balance)),
      totalWageBill: formatSalary(thousands(wageAgg?._sum.salary ?? null)),
      squadSize: wageAgg?._count ?? 0,
    },
    topPlayers: topPlayers.map((p) => ({
      name: p.name,
      position: p.position,
      age: p.age,
      ovr: p.ovr,
      potential: p.potential,
      status: p.status,
    })),
    currentSeason: {
      competitions: lastTeamStats.map((t) => ({
        competition: t.competition?.name ?? 'Overall',
        type: t.competition?.type ?? null,
        wins: t.wins,
        draws: t.draws,
        losses: t.losses,
        goalsFor: t.goalsPro,
        goalsAgainst: t.goalsAgainst,
        result:
          t.competition?.type === 'League'
            ? t.leaguePosition !== null
              ? `${t.leaguePosition}º`
              : null
            : t.cupResult ?? null,
      })),
    },
  }

  const text = JSON.stringify(payload)
  await cacheSet(cacheKey, text, TTL)
  return text
}
