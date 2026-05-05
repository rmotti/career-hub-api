import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLUBS_BY_LEAGUE, LEAGUE_TO_COUNTRY } from '../src/features/clubs/clubs.service.js'
import { toFitScoreClubName } from '../src/shared/utils/fit-score-maps.js'

type ServiceClub = {
  name: string
  profileCount: number
  sampleCount: number
  positions: string[]
}

type Match = {
  club: ServiceClub
  score: number
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultArtifactsDir = resolve(repoRoot, '..', 'fit-score-svc', 'artifacts')
const defaultPython =
  process.platform === 'win32'
    ? resolve(repoRoot, '..', 'fit-score-svc', '.venv', 'Scripts', 'python.exe')
    : resolve(repoRoot, '..', 'fit-score-svc', '.venv', 'bin', 'python')

const artifactsDir = resolve(process.env.FIT_SCORE_ARTIFACTS_DIR ?? defaultArtifactsDir)
const pythonBin = resolve(process.env.FIT_SCORE_PYTHON ?? defaultPython)
const outputPath = resolve(process.argv[2] ?? 'data/fit-score-club-alias-report.csv')
const unresolvedOutputPath = resolve(process.env.FIT_SCORE_NON_EXACT_OUTPUT ?? 'data/fit-score-club-alias-non-exact.csv')

if (!existsSync(pythonBin)) {
  throw new Error(`Python not found at ${pythonBin}. Set FIT_SCORE_PYTHON to the fit-score-svc venv python.`)
}

if (!existsSync(resolve(artifactsDir, 'club_profiles.pkl'))) {
  throw new Error(`club_profiles.pkl not found in ${artifactsDir}. Set FIT_SCORE_ARTIFACTS_DIR.`)
}

const serviceClubs = loadServiceClubs()
const serviceByName = new Map(serviceClubs.map((club) => [club.name, club]))
const appClubRows = Object.entries(CLUBS_BY_LEAGUE).flatMap(([appLeague, clubs]) =>
  clubs.map((appClub) => ({
    appClub,
    appLeague,
    appCountry: LEAGUE_TO_COUNTRY[appLeague] ?? '',
  })),
)

const rows = appClubRows.map(({ appClub, appLeague, appCountry }) => {
  const mappedName = toFitScoreClubName(appClub, appLeague)
  const serviceClub = serviceByName.get(mappedName)
  const matches = findMatches(mappedName, serviceClubs, 5)
  const best = matches[0]

  const status = serviceClub
    ? mappedName === appClub ? 'exact' : 'mapped'
    : best?.score >= 0.9 ? 'suggest'
      : best?.score >= 0.72 ? 'review'
        : 'missing'

  const suggested = serviceClub ?? best?.club

  return {
    appClub,
    appLeague,
    appCountry,
    fitScoreClub: mappedName,
    status,
    suggestedFitScoreClub: suggested?.name ?? '',
    similarity: serviceClub ? '1.000' : (best?.score.toFixed(3) ?? ''),
    profileCount: suggested?.profileCount.toString() ?? '',
    sampleCount: suggested?.sampleCount.toString() ?? '',
    positions: suggested?.positions.join('|') ?? '',
    topCandidates: matches.map((match) => `${match.club.name} (${match.score.toFixed(3)})`).join(' | '),
  }
})

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, toCsv(rows), 'utf8')

const unresolvedRows = rows.filter((row) => !['exact', 'mapped'].includes(row.status))
mkdirSync(dirname(unresolvedOutputPath), { recursive: true })
writeFileSync(unresolvedOutputPath, toCsv(unresolvedRows), 'utf8')

const counts = rows.reduce<Record<string, number>>((acc, row) => {
  acc[row.status] = (acc[row.status] ?? 0) + 1
  return acc
}, {})

console.log(`Report written to ${outputPath}`)
console.log(`Unresolved report written to ${unresolvedOutputPath}`)
console.log(`API club/league rows: ${appClubRows.length}`)
console.log(`Fit score service clubs: ${serviceClubs.length}`)
console.log(
  Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${status}: ${count}`)
    .join(', '),
)

function loadServiceClubs(): ServiceClub[] {
  const code = `
import json
import pickle
import sys
from pathlib import Path

profiles_path = Path(sys.argv[1]) / "club_profiles.pkl"
with profiles_path.open("rb") as f:
    club_profiles = pickle.load(f)

clubs = {}
for key, profile in club_profiles.items():
    club_name, position_group = key
    club = clubs.setdefault(club_name, {"profileCount": 0, "sampleCount": 0, "positions": set()})
    club["profileCount"] += 1
    club["sampleCount"] += len(profile)
    club["positions"].add(position_group)

print(json.dumps([
    {
        "name": name,
        "profileCount": data["profileCount"],
        "sampleCount": data["sampleCount"],
        "positions": sorted(data["positions"]),
    }
    for name, data in sorted(clubs.items())
], ensure_ascii=False))
`

  const output = execFileSync(pythonBin, ['-c', code, artifactsDir], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 1024 * 1024 * 10,
  })

  return JSON.parse(output) as ServiceClub[]
}

function findMatches(name: string, clubs: ServiceClub[], limit: number): Match[] {
  const normalizedName = normalizeName(name)

  return clubs
    .map((club) => ({
      club,
      score: similarity(normalizedName, normalizeName(club.name)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(f\.?c\.?|c\.?f\.?|a\.?f\.?c\.?|s\.?c\.?|club)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0

  const charScore = diceCoefficient(a, b)
  const tokenScore = tokenOverlap(a, b)
  return Math.max(
    (charScore * 0.7) + (tokenScore * 0.3),
    subsetNameScore(a, b),
  )
}

function subsetNameScore(a: string, b: string): number {
  const aTokens = a.split(' ').filter(Boolean)
  const bTokens = b.split(' ').filter(Boolean)
  if (!aTokens.length || !bTokens.length) return 0

  const shorter = aTokens.length <= bTokens.length ? aTokens : bTokens
  const longer = aTokens.length <= bTokens.length ? bTokens : aTokens

  if (shorter.length === longer.length) return 0
  if (shorter.length === 1 && isGenericSingleToken(shorter[0])) return 0
  if (!shorter.every((token) => longer.includes(token))) return 0

  return 0.9 + (0.08 * (shorter.length / longer.length))
}

function isGenericSingleToken(token: string): boolean {
  return new Set([
    'athletic',
    'city',
    'county',
    'rangers',
    'town',
    'united',
    'wanderers',
  ]).has(token)
}

function diceCoefficient(a: string, b: string): number {
  const aPairs = bigrams(a)
  const bPairs = bigrams(b)
  if (!aPairs.length || !bPairs.length) return 0

  const counts = new Map<string, number>()
  for (const pair of aPairs) counts.set(pair, (counts.get(pair) ?? 0) + 1)

  let intersection = 0
  for (const pair of bPairs) {
    const count = counts.get(pair) ?? 0
    if (count > 0) {
      counts.set(pair, count - 1)
      intersection += 1
    }
  }

  return (2 * intersection) / (aPairs.length + bPairs.length)
}

function bigrams(value: string): string[] {
  if (value.length < 2) return value ? [value] : []
  const result: string[] = []
  for (let i = 0; i < value.length - 1; i += 1) {
    result.push(value.slice(i, i + 2))
  }
  return result
}

function tokenOverlap(a: string, b: string): number {
  const aTokens = new Set(a.split(' ').filter(Boolean))
  const bTokens = new Set(b.split(' ').filter(Boolean))
  if (!aTokens.size || !bTokens.size) return 0

  let intersection = 0
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1
  }

  return (2 * intersection) / (aTokens.size + bTokens.size)
}

function toCsv(items: Array<Record<string, string>>): string {
  if (!items.length) return ''

  const headers = Object.keys(items[0])
  const lines = [
    headers.join(','),
    ...items.map((item) => headers.map((header) => csvEscape(item[header] ?? '')).join(',')),
  ]

  return `${lines.join('\n')}\n`
}

function csvEscape(value: string): string {
  if (!/[",\n]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}
