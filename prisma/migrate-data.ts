/**
 * Migração de dados para a feature de competições.
 *
 * Rode APÓS a migration do Prisma (step 1) e APÓS seed-competitions.ts:
 *   npx tsx prisma/seed-competitions.ts
 *   npx tsx prisma/migrate-data.ts
 *
 * O que este script faz:
 *  1. Para cada TeamSeasonStats existente: define competitionId com a liga do clube
 *  2. Para cada TeamSeasonStats com europeanCupResult != NaoParticipou: cria nova linha para UEFA CL
 *  3. Para cada TeamSeasonStats com nationalCupResult != NaoParticipou: cria nova linha para a copa nacional
 *  4. Para cada Trophy: define competitionId com base no campo name
 */
import { PrismaClient } from '@prisma/client'
import { CLUBS_BY_LEAGUE } from '../src/features/clubs/clubs.service.js'

const prisma = new PrismaClient()

const LEAGUE_TO_COUNTRY: Record<string, string> = {
  'Premier League': 'England',
  'La Liga':        'Spain',
  'Bundesliga':     'Germany',
  'Serie A':        'Italy',
  'Ligue 1':        'France',
}

const LEAGUE_TO_NATIONAL_CUP: Record<string, string> = {
  'Premier League': 'FA Cup',
  'La Liga':        'Copa del Rey',
  'Bundesliga':     'DFB-Pokal',
  'Serie A':        'Coppa Italia',
  'Ligue 1':        'Coupe de France',
}

function findLeagueByClub(club: string): string | null {
  for (const [league, clubs] of Object.entries(CLUBS_BY_LEAGUE)) {
    if (clubs.includes(club)) return league
  }
  return null
}

async function main() {
  console.log('Starting data migration...')

  const competitions = await prisma.competition.findMany()
  if (!competitions.length) {
    throw new Error('No competitions found. Run seed-competitions.ts first.')
  }
  const compByName = Object.fromEntries(competitions.map((c) => [c.name, c]))

  // ── TeamSeasonStats ───────────────────────────────────────────────────────

  const allStats = await prisma.teamSeasonStats.findMany({
    include: { clubStint: { select: { club: true } } },
  })

  let statsUpdated = 0
  let cupRowsCreated = 0

  for (const stat of allStats) {
    const league = findLeagueByClub(stat.clubStint.club)
    if (!league) {
      console.warn(`Club not found in any league: ${stat.clubStint.club}`)
      continue
    }

    const leagueComp = compByName[league]
    if (!leagueComp) continue

    await prisma.$executeRaw`
      UPDATE "TeamSeasonStats"
      SET "competitionId" = ${leagueComp.id}
      WHERE id = ${stat.id}
    `
    statsUpdated++

    // Cria linha para copa europeia se houver resultado
    const euResult = (stat as Record<string, unknown>).europeanCupResult as string
    if (euResult && euResult !== 'NaoParticipou') {
      const clComp = compByName['UEFA Champions League']
      if (clComp) {
        try {
          await prisma.$executeRaw`
            INSERT INTO "TeamSeasonStats"
              ("id", "clubStintId", "competitionId", "season",
               "goalsPro", "goalsAgainst", "wins", "draws", "losses",
               "cupResult", "europeanCupResult", "nationalCupResult",
               "createdAt", "updatedAt")
            VALUES (
              gen_random_uuid()::text, ${stat.clubStintId}, ${clComp.id}, ${stat.season},
              0, 0, 0, 0, 0,
              ${euResult}::"CupResult", 'NaoParticipou'::"CupResult", 'NaoParticipou'::"CupResult",
              NOW(), NOW()
            )
          `
          cupRowsCreated++
        } catch {
          console.warn(`Skipped duplicate EU row: ${stat.clubStint.club} ${stat.season}`)
        }
      }
    }

    // Cria linha para copa nacional se houver resultado
    const natResult = (stat as Record<string, unknown>).nationalCupResult as string
    if (natResult && natResult !== 'NaoParticipou') {
      const natCupName = LEAGUE_TO_NATIONAL_CUP[league]
      const natComp = compByName[natCupName]
      if (natComp) {
        try {
          await prisma.$executeRaw`
            INSERT INTO "TeamSeasonStats"
              ("id", "clubStintId", "competitionId", "season",
               "goalsPro", "goalsAgainst", "wins", "draws", "losses",
               "cupResult", "europeanCupResult", "nationalCupResult",
               "createdAt", "updatedAt")
            VALUES (
              gen_random_uuid()::text, ${stat.clubStintId}, ${natComp.id}, ${stat.season},
              0, 0, 0, 0, 0,
              ${natResult}::"CupResult", 'NaoParticipou'::"CupResult", 'NaoParticipou'::"CupResult",
              NOW(), NOW()
            )
          `
          cupRowsCreated++
        } catch {
          console.warn(`Skipped duplicate national cup row: ${stat.clubStint.club} ${stat.season}`)
        }
      }
    }
  }

  // ── Trophies ──────────────────────────────────────────────────────────────

  const trophies = await prisma.trophy.findMany({
    include: { clubStint: { select: { club: true } } },
  })

  let trophiesUpdated = 0

  for (const trophy of trophies) {
    const trophyName = (trophy as Record<string, unknown>).name as string | null
    if (!trophyName) continue

    const league = findLeagueByClub(trophy.clubStint.club)
    let competitionId: string | null = null

    if (trophyName.includes('Campeão da Liga')) {
      competitionId = league ? (compByName[league]?.id ?? null) : null
    } else if (trophyName.includes('Campeão Europeu')) {
      competitionId = compByName['UEFA Champions League']?.id ?? null
    } else if (trophyName.includes('Campeão da Copa Nacional')) {
      const cupName = league ? LEAGUE_TO_NATIONAL_CUP[league] : null
      competitionId = cupName ? (compByName[cupName]?.id ?? null) : null
    }

    if (competitionId) {
      await prisma.$executeRaw`
        UPDATE "Trophy" SET "competitionId" = ${competitionId} WHERE id = ${trophy.id}
      `
      trophiesUpdated++
    } else {
      console.warn(`Could not map trophy to competition: "${trophyName}"`)
    }
  }

  console.log(`✓ TeamSeasonStats atualizadas: ${statsUpdated}`)
  console.log(`✓ Linhas de copa criadas: ${cupRowsCreated}`)
  console.log(`✓ Trophies migrados: ${trophiesUpdated}`)
  console.log('')
  console.log('Próximo passo — atualize schema.prisma para o estado final e rode:')
  console.log('  npx prisma migrate dev --name finalize_competitions')
  console.log('')
  console.log('Mudanças para o schema final:')
  console.log('  TeamSeasonStats: competitionId String (obrigatório), remover europeanCupResult/nationalCupResult, adicionar @@unique([clubStintId, competitionId, season])')
  console.log('  Trophy: competitionId String (obrigatório), remover name, adicionar @@unique([clubStintId, competitionId, year])')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
