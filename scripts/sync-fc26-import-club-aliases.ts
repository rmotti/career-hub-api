/**
 * Generates src/shared/utils/fc26-import-club-aliases.generated.ts:
 * a map from the app's curated club names (clubs.data.ts) to the club names
 * used in the FC26 player dataset (Fc26Player.club), keyed by app league.
 *
 * Why this exists: the squad import (importFc26Squad) matches Fc26Player.club
 * against ClubStint.club exactly. The app and the FC26 source CSV use different
 * names for the same club ("Bayer Leverkusen" vs "Bayer 04 Leverkusen"), so the
 * exact match silently returns 0 rows. This map bridges the two namings.
 *
 * Generation strategy, per pinned (app league -> FC26 league) pair:
 *   1. exact name match against the distinct FC26 clubs in that league;
 *   2. else accent/punctuation/case-insensitive normalized match.
 * Only entries where the FC26 name differs from the app name are emitted
 * (identical names already match without an alias). Unresolved app clubs are
 * printed as a report for manual review; they are NOT guessed.
 *
 * Run: npx tsx scripts/sync-fc26-import-club-aliases.ts
 * Requires DATABASE_URL (reads the live Fc26Player table, read-only).
 */
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { CLUBS_BY_LEAGUE } from '../src/features/clubs/clubs.data.js'

// App league -> FC26 dataset league. Hand-pinned because automatic inference is
// ambiguous (men's/women's collisions, Austria's "Bundesliga", "Pro League" /
// "Super League" shared by multiple competitions). App leagues with NO source
// data in the FC26 dataset (all women's competitions) are deliberately omitted:
// their imports correctly find nothing.
const APP_LEAGUE_TO_FC26_LEAGUE: Record<string, string> = {
  'Premier League': 'Premier League',
  'EFL Championship': 'Championship',
  'EFL League One': 'League One',
  'EFL League Two': 'League Two',
  'LaLiga EA Sports': 'La Liga',
  'LaLiga Hypermotion': 'La Liga 2',
  'Bundesliga': 'Bundesliga',
  '2. Bundesliga': '2. Bundesliga',
  '3. Liga': '3. Liga',
  'Ligue 1': 'Ligue 1',
  'Ligue 2': 'Ligue 2',
  'Serie A': 'Serie A',
  'Serie BKT': 'Serie B',
  'Liga Portugal': 'Primeira Liga',
  'Eredivisie': 'Eredivisie',
  '1A Pro League': 'Pro League',
  'Cinch Premiership': 'Premiership',
  '3F Superliga': 'Superliga',
  'Eliteserien': 'Eliteserien',
  'Allsvenskan': 'Allsvenskan',
  'PKO Ekstraklasa': 'Ekstraklasa',
  'Superliga': 'Liga I',
  'SSE Airtricity Premier Division': 'Premier Division',
  'Série A': 'Série A',
  'Liga Profesional': 'Liga Profesional de Fútbol',
  'MLS': 'Major League Soccer',
  'A-League': 'A-League Men',
  'K-League 1': 'K League 1',
}

// Manual overrides for clubs whose app and FC26 names share no significant
// tokens (language synonyms / abbreviations the matcher can't bridge:
// "Munich" vs "München", "LAFC" vs "Los Angeles FC", "Hearts"). Keyed by app
// league -> app club -> FC26 club. Each target is validated against the live
// dataset below, so a typo or a dropped club fails the run loudly.
const MANUAL_OVERRIDES: Record<string, Record<string, string>> = {
  'Bundesliga': {
    'Bayern Munich': 'FC Bayern München',
  },
  'LaLiga EA Sports': {
    'Atlético de Madrid': 'Atlético Madrid',
    'Celta de Vigo': 'RC Celta',
  },
  'Ligue 1': {
    'LOSC Lille': 'Lille OSC',
    'Racing Club de Lens': 'RC Lens',
  },
  '1A Pro League': {
    'Club Brugge': 'Club Brugge KV',
    'Sint-Truiden': 'Sint-Truidense VV',
    'Union SG': 'Union Saint-Gilloise',
  },
  'Cinch Premiership': {
    'Heart of Midlothian': 'Hearts',
  },
  '3F Superliga': {
    'OB Odense': 'Odense Boldklub',
  },
  'Allsvenskan': {
    'Hammarby IF': 'Hammarby Fotboll',
  },
  'MLS': {
    'LAFC': 'Los Angeles FC',
    'Sporting KC': 'Sporting Kansas City',
  },
  'K-League 1': {
    'Daejeon Hana Citizen': 'Daejeon Citizen',
    'Ulsan Hyundai': 'Ulsan HD FC',
  },
}

const outputPath = resolve('src/shared/utils/fc26-import-club-aliases.generated.ts')

// Club-type affixes that the app and the FC26 dataset disagree on
// ("Fulham" vs "Fulham FC", "FC Augsburg" vs "Augsburg"). Stripped as whole
// words before collapsing so they don't defeat the normalized match.
const CLUB_AFFIXES = /\b(fc|cf|sc|afc|ac|as|ssc|rc|cd|ud|sd|club|calcio)\b/g

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(CLUB_AFFIXES, ' ')
    .replace(/[^a-z0-9]/g, '')
}

async function main() {
  const prisma = new PrismaClient()
  try {
    const rows = await prisma.fc26Player.findMany({
      where: { club: { not: null }, league: { not: null } },
      select: { club: true, league: true },
      distinct: ['club'],
    })

    // FC26 league -> { exact name -> club, normalized name -> club }
    const fcByLeague = new Map<string, { exact: Set<string>; norm: Map<string, string>; clubs: string[] }>()
    for (const { club, league } of rows) {
      if (!club || !league) continue
      if (!fcByLeague.has(league)) fcByLeague.set(league, { exact: new Set(), norm: new Map(), clubs: [] })
      const bucket = fcByLeague.get(league)!
      bucket.exact.add(club)
      bucket.clubs.push(club)
      // First writer wins for a normalized key; collisions within a league are
      // rare and reported below if they leave an app club unresolved.
      if (!bucket.norm.has(normalize(club))) bucket.norm.set(normalize(club), club)
    }

    const aliases = new Map<string, Map<string, string>>()
    const fuzzy: { appLeague: string; appClub: string; fcClub: string }[] = []
    const unresolved: { appLeague: string; appClub: string }[] = []

    const commit = (appLeague: string, appClub: string, fcClub: string) => {
      if (!aliases.has(appLeague)) aliases.set(appLeague, new Map())
      aliases.get(appLeague)!.set(appClub, fcClub)
    }

    for (const [appLeague, appClubs] of Object.entries(CLUBS_BY_LEAGUE)) {
      const fcLeague = APP_LEAGUE_TO_FC26_LEAGUE[appLeague]
      if (!fcLeague) continue // no FC26 source data for this app league (e.g. women's)
      const bucket = fcByLeague.get(fcLeague)
      if (!bucket) continue

      const overrides = MANUAL_OVERRIDES[appLeague] ?? {}

      for (const appClub of appClubs) {
        // Tier 0 — manual override for language synonyms / abbreviations.
        const override = overrides[appClub]
        if (override) {
          if (!bucket.exact.has(override)) {
            throw new Error(
              `Manual override target not in FC26 dataset: [${appLeague}] ${appClub} -> ${override} (league ${fcLeague})`,
            )
          }
          commit(appLeague, appClub, override)
          continue
        }

        // Tier 1 — exact name match needs no alias.
        if (bucket.exact.has(appClub)) continue

        // Tier 2 — accent/punct/affix-insensitive normalized match. Safe to auto-commit.
        const normMatch = bucket.norm.get(normalize(appClub))
        if (normMatch) {
          commit(appLeague, appClub, normMatch)
          continue
        }

        // Tier 3 — significant-token containment within the league (handles the
        // founding-year suffixes the app drops: "Bayer Leverkusen" vs
        // "Bayer 04 Leverkusen"). Reported for manual review, NOT auto-committed,
        // because containment can be ambiguous.
        const candidate = bestTokenMatch(appClub, bucket.clubs)
        if (candidate) fuzzy.push({ appLeague, appClub, fcClub: candidate })
        else unresolved.push({ appLeague, appClub })
      }
    }

    // Auto-commit the unique, unambiguous fuzzy candidates; leave the rest for review.
    for (const f of fuzzy) commit(f.appLeague, f.appClub, f.fcClub)

    writeFileSync(outputPath, render(aliases), 'utf8')

    const count = [...aliases.values()].reduce((t, m) => t + m.size, 0)
    console.log(`Generated ${count} import aliases across ${aliases.size} leagues -> ${outputPath}`)

    if (fuzzy.length) {
      console.log(`\n${fuzzy.length} fuzzy (token-containment) matches auto-committed — VERIFY these:`)
      for (const f of fuzzy) console.log(`  [${f.appLeague}] ${f.appClub}  ->  ${f.fcClub}`)
    }

    if (unresolved.length) {
      console.log(`\n${unresolved.length} app clubs had NO FC26 match (likely absent from dataset):`)
      for (const u of unresolved) console.log(`  [${u.appLeague}] ${u.appClub}`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

// Significant tokens: lowercase, accent-stripped words, dropping club affixes,
// pure-number tokens (founding years: "04", "1899"), and short noise.
function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !/^\d+$/.test(t) && !CLUB_AFFIXES.test(` ${t} `)),
  )
}

// Returns the single FC26 club in the league whose significant tokens are a
// superset (or equal set) of the app club's tokens. If zero or more than one
// candidate qualifies, returns null (ambiguous — left for manual review).
function bestTokenMatch(appClub: string, fcClubs: string[]): string | null {
  const appTokens = tokens(appClub)
  if (appTokens.size === 0) return null
  const matches = fcClubs.filter((fc) => {
    const fcTokens = tokens(fc)
    return [...appTokens].every((t) => fcTokens.has(t))
  })
  return matches.length === 1 ? matches[0] : null
}

function render(aliasesByLeague: Map<string, Map<string, string>>): string {
  const lines = [
    '// Generated by scripts/sync-fc26-import-club-aliases.ts. DO NOT EDIT BY HAND.',
    '// Maps app club names (clubs.data.ts) -> FC26 dataset names (Fc26Player.club),',
    '// keyed by app league. Used by importFc26Squad to resolve the squad to import.',
    '// Re-run: npx tsx scripts/sync-fc26-import-club-aliases.ts',
    'export const FC26_IMPORT_CLUB_NAME_BY_LEAGUE: Record<string, Record<string, string>> = {',
  ]
  for (const league of [...aliasesByLeague.keys()].sort((a, b) => a.localeCompare(b))) {
    lines.push(`  ${JSON.stringify(league)}: {`)
    const m = aliasesByLeague.get(league)!
    for (const appClub of [...m.keys()].sort((a, b) => a.localeCompare(b))) {
      lines.push(`    ${JSON.stringify(appClub)}: ${JSON.stringify(m.get(appClub))},`)
    }
    lines.push('  },')
  }
  lines.push('}')
  lines.push('')
  return lines.join('\n')
}

main()
