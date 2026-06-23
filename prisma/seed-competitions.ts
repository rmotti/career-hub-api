import { PrismaClient, CompetitionType } from '@prisma/client'
import { LEAGUE_TO_COUNTRY } from '../src/features/clubs/clubs.data.js'

const prisma = new PrismaClient()

// Domestic competitions per country, keyed by the `country` value in LEAGUE_TO_COUNTRY
// (clubs.data.ts) — that key is what saves/club-stints resolve a club to when seeding
// per-competition TeamSeasonStats (see saves.service.ts -> getCompetitionIdsByCountry).
// Every country that has selectable clubs MUST have an entry here, or a save created for one
// of its clubs would have no league/cup to track. The coverage guard below enforces that.
// Each country lists its top-flight league + the main national cup (+ a super cup where one
// exists). Lower divisions intentionally reuse the same domestic cups, so they need no extra
// rows. Continental cups are Europe-only by decision (F-005) and live in EUROPEAN below.
export const DOMESTIC: Record<string, { name: string; type: CompetitionType }[]> = {
  England: [
    { name: 'Premier League',     type: 'League' },
    { name: 'FA Cup',             type: 'NationalCup' },
    { name: 'Carabao Cup',        type: 'NationalCup' },
    { name: 'FA Community Shield', type: 'SuperCup' },
  ],
  Spain: [
    { name: 'LaLiga EA Sports',   type: 'League' },
    { name: 'Copa del Rey',       type: 'NationalCup' },
    { name: 'Supercopa de España', type: 'SuperCup' },
  ],
  Germany: [
    { name: 'Bundesliga',                 type: 'League' },
    { name: 'DFB-Pokal',                  type: 'NationalCup' },
    { name: 'Franz Beckenbauer Supercup', type: 'SuperCup' },
  ],
  France: [
    { name: 'Ligue 1',               type: 'League' },
    { name: 'Coupe de France',       type: 'NationalCup' },
    { name: 'Trophée des Champions', type: 'SuperCup' },
  ],
  Italy: [
    { name: 'Serie A',             type: 'League' },
    { name: 'Coppa Italia',        type: 'NationalCup' },
    { name: 'Supercoppa Italiana', type: 'SuperCup' },
  ],
  Portugal: [
    { name: 'Liga Portugal',      type: 'League' },
    { name: 'Taça de Portugal',   type: 'NationalCup' },
    { name: 'Taça da Liga',       type: 'NationalCup' },
    { name: 'Supertaça Cândido de Oliveira', type: 'SuperCup' },
  ],
  Netherlands: [
    { name: 'Eredivisie',           type: 'League' },
    { name: 'TOTO KNVB Beker',      type: 'NationalCup' },
    { name: 'Johan Cruijff Schaal', type: 'SuperCup' },
  ],
  Belgium: [
    { name: '1A Pro League',     type: 'League' },
    { name: 'Croky Cup',        type: 'NationalCup' },
    { name: 'Belgian Super Cup', type: 'SuperCup' },
  ],
  Scotland: [
    { name: 'Cinch Premiership', type: 'League' },
    { name: 'Scottish Cup',      type: 'NationalCup' },
    { name: 'Scottish League Cup', type: 'NationalCup' },
  ],
  Denmark: [
    { name: '3F Superliga',     type: 'League' },
    { name: 'DBU Pokalen',      type: 'NationalCup' },
  ],
  Norway: [
    { name: 'Eliteserien',     type: 'League' },
    { name: 'Norwegian Cup',   type: 'NationalCup' },
  ],
  Sweden: [
    { name: 'Allsvenskan',     type: 'League' },
    { name: 'Svenska Cupen',   type: 'NationalCup' },
  ],
  Poland: [
    { name: 'PKO Ekstraklasa', type: 'League' },
    { name: 'Polish Cup',      type: 'NationalCup' },
    { name: 'Polish Super Cup', type: 'SuperCup' },
  ],
  Romania: [
    { name: 'Superliga',       type: 'League' },
    { name: 'Cupa României',   type: 'NationalCup' },
    { name: 'Supercupa României', type: 'SuperCup' },
  ],
  Ireland: [
    { name: 'SSE Airtricity Premier Division', type: 'League' },
    { name: 'FAI Cup',                          type: 'NationalCup' },
  ],
  Austria: [
    { name: 'Admiral Bundesliga', type: 'League' },
    { name: 'ÖFB-Cup',            type: 'NationalCup' },
  ],
  Brazil: [
    { name: 'Brasileirão Série A', type: 'League' },
    { name: 'Copa do Brasil',      type: 'NationalCup' },
    { name: 'Supercopa do Brasil', type: 'SuperCup' },
  ],
  Argentina: [
    { name: 'Liga Profesional',  type: 'League' },
    { name: 'Copa Argentina',    type: 'NationalCup' },
    { name: 'Supercopa Argentina', type: 'SuperCup' },
  ],
  USA: [
    { name: 'MLS',          type: 'League' },
    { name: 'U.S. Open Cup', type: 'NationalCup' },
  ],
  Australia: [
    { name: 'A-League',       type: 'League' },
    { name: 'Australia Cup',  type: 'NationalCup' },
  ],
  'Saudi Arabia': [
    { name: 'MBS Pro League',     type: 'League' },
    { name: "King's Cup",         type: 'NationalCup' },
    { name: 'Saudi Super Cup',    type: 'SuperCup' },
  ],
  China: [
    { name: 'Chinese Super League', type: 'League' },
    { name: 'Chinese FA Cup',       type: 'NationalCup' },
  ],
  India: [
    { name: 'Hero ISL',        type: 'League' },
    { name: 'Super Cup',       type: 'NationalCup' },
  ],
  'South Korea': [
    { name: 'K-League 1',  type: 'League' },
    { name: 'Korean FA Cup', type: 'NationalCup' },
  ],
}

export const EUROPEAN: { name: string; type: CompetitionType; country: null }[] = [
  { name: 'UEFA Champions League',  type: 'EuropeanCup', country: null },
  { name: 'UEFA Europa League',     type: 'EuropeanCup', country: null },
  { name: 'UEFA Conference League', type: 'EuropeanCup', country: null },
  { name: 'UEFA Super Cup',         type: 'EuropeanCup', country: null },
]

export function buildCompetitions(): { name: string; type: CompetitionType; country: string | null }[] {
  // Coverage guard: every country that has selectable clubs must have domestic competitions,
  // otherwise a save created for one of its clubs would track nothing. Fail loudly at seed
  // time rather than silently shipping a country with no league/cup.
  const countriesWithClubs = [...new Set(Object.values(LEAGUE_TO_COUNTRY).filter(Boolean))]
  const missing = countriesWithClubs.filter((c) => !DOMESTIC[c])
  if (missing.length > 0) {
    throw new Error(
      `seed-competitions: no competitions defined for: ${missing.join(', ')}. ` +
        `Add them to DOMESTIC (every LEAGUE_TO_COUNTRY country needs an entry).`,
    )
  }

  const domestic = Object.entries(DOMESTIC).flatMap(([country, comps]) =>
    comps.map((c) => ({ ...c, country })),
  )
  return [...domestic, ...EUROPEAN]
}

async function main() {
  const competitions = buildCompetitions()
  console.log(`Seeding ${competitions.length} competitions across ${Object.keys(DOMESTIC).length} countries...`)

  for (const comp of competitions) {
    await prisma.competition.upsert({
      where: { name: comp.name },
      create: comp,
      update: {},
    })
  }

  console.log(`✓ ${competitions.length} competitions seeded.`)
}

// Only run when executed directly (tsx prisma/seed-competitions.ts), not when imported
// by tests that exercise buildCompetitions() / the coverage guard without touching the DB.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
