/**
 * Drift check for the generated fit-score club-alias map.
 *
 * The generated file (`src/shared/utils/fit-score-club-aliases.generated.ts`) is committed,
 * but its source worksheet CSV is gitignored and the regeneration needs the sibling
 * `fit-score-svc` Python venv + `club_profiles.pkl` — so this can't run in CI. It's a LOCAL
 * guard for whoever edits the worksheet: it compares the SHA-256 of the current worksheet
 * against the `// worksheet-sha256:` stamp baked into the generated file by the sync script.
 *
 * Exit codes: 0 = in sync, or skipped (worksheet/stamp absent — nothing to compare);
 *             1 = the worksheet changed since the last sync → run `npm run fit-score:clubs:sync`.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const worksheetPath = resolve(process.argv[2] ?? 'data/fit-score-club-alias-updated - Worksheet.csv')
const generatedPath = resolve('src/shared/utils/fit-score-club-aliases.generated.ts')

if (!existsSync(worksheetPath)) {
  console.log(`fit-score:clubs:check — skip: worksheet not present (${worksheetPath}). Nothing to compare.`)
  process.exit(0)
}

if (!existsSync(generatedPath)) {
  console.error(`fit-score:clubs:check — generated file missing (${generatedPath}). Run npm run fit-score:clubs:sync.`)
  process.exit(1)
}

const generated = readFileSync(generatedPath, 'utf8')
const stampMatch = generated.match(/\/\/ worksheet-sha256: ([0-9a-f]{64})/)

if (!stampMatch) {
  console.warn(
    'fit-score:clubs:check — skip: generated file has no worksheet-sha256 stamp (predates provenance stamping). ' +
      'Run npm run fit-score:clubs:sync once to stamp it.',
  )
  process.exit(0)
}

const stampedHash = stampMatch[1]
const currentHash = createHash('sha256').update(readFileSync(worksheetPath, 'utf8')).digest('hex')

if (stampedHash === currentHash) {
  console.log('fit-score:clubs:check — in sync.')
  process.exit(0)
}

console.error(
  'fit-score:clubs:check — OUT OF SYNC: the worksheet changed since the alias map was last generated.\n' +
    `  worksheet: ${worksheetPath}\n` +
    '  Run: npm run fit-score:clubs:sync  (needs the fit-score-svc venv + club_profiles.pkl)\n' +
    '  then commit src/shared/utils/fit-score-club-aliases.generated.ts.',
)
process.exit(1)
