/**
 * Limpeza pontual: remove ClubStints intermediários criados por engano ao
 * trocar de clube repetidamente na mesma temporada.
 *
 * Caso: save com sequência Ajax (2025) → United → Ajax → United (todos 2026).
 * Objetivo: manter apenas o PRIMEIRO Ajax e o ÚLTIMO United, apagando os 2 do meio.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/cleanup-duplicate-stints.ts            # dry-run (só lista)
 *   npx tsx --env-file=.env.local scripts/cleanup-duplicate-stints.ts --confirm  # executa o delete
 *
 * Opcional: passe --save=<saveId> para mirar um save específico. Sem isso, o
 * script procura saves que tenham >2 stints e te mostra para você confirmar.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const CONFIRM = process.argv.includes('--confirm')

// Save alvo desta limpeza pontual: "Ajax" com a sequência
// Ajax(2025) → United → Ajax → United(atual). Os dois stints do meio são
// duplicatas criadas por engano ao trocar de clube repetidas vezes na mesma
// temporada. Travado por ID de propósito — NÃO varrer outros saves, que têm
// passagens intermediárias legítimas.
const TARGET_SAVE_ID = '6449a8a8-9a64-4a21-bcfd-5a64638ba515'

// IDs exatos a apagar (stints [2] e [3] do save acima), confirmados via dry-run.
const TARGET_STINT_IDS = [
  'd4928707-9508-4690-8741-c4cef873f273', // Manchester United 2026-2026
  '6ff9c897-ca38-40d7-aeb9-f3858fa5cfb6', // Ajax 2026-2026
]

async function relatedCounts(stintId: string) {
  const [teamStats, playerStats, trophies, transfers, players] = await Promise.all([
    prisma.teamSeasonStats.count({ where: { clubStintId: stintId } }),
    prisma.playerSeasonStats.count({ where: { clubStintId: stintId } }),
    prisma.trophy.count({ where: { clubStintId: stintId } }),
    prisma.transfer.count({ where: { clubStintId: stintId } }),
    prisma.player.count({ where: { activeClubStintId: stintId } }),
  ])
  return { teamStats, playerStats, trophies, transfers, players }
}

async function main() {
  const save = await prisma.save.findUnique({
    where: { id: TARGET_SAVE_ID },
    include: { clubStints: { orderBy: { createdAt: 'asc' } } },
  })

  if (!save) {
    console.log(`Save alvo ${TARGET_SAVE_ID} não encontrado. Nada a fazer.`)
    return
  }

  console.log(`\n=== Save: ${save.name} (${save.id}) ===`)
  console.log(`    temporada atual: ${save.currentSeason} | userId: ${save.userId}`)
  console.log(`    Stints (ordem de criação):`)

  for (let i = 0; i < save.clubStints.length; i++) {
    const st = save.clubStints[i]
    const counts = await relatedCounts(st.id)
    const verdict = TARGET_STINT_IDS.includes(st.id) ? 'APAGAR' : 'MANTER'
    console.log(
      `      [${i + 1}] ${verdict.padEnd(6)} ${st.club.padEnd(18)} ${st.startYear}-${st.endYear ?? 'present'}  isCurrent=${st.isCurrent}  id=${st.id}`,
    )
    console.log(
      `              relacionados → teamStats=${counts.teamStats} playerStats=${counts.playerStats} trophies=${counts.trophies} transfers=${counts.transfers} players=${counts.players}`,
    )
  }

  // Só apaga stints que: pertencem ao save alvo, estão na lista explícita e NÃO são o atual.
  const toDelete = save.clubStints.filter(
    (st) => TARGET_STINT_IDS.includes(st.id) && !st.isCurrent,
  )

  const missing = TARGET_STINT_IDS.filter(
    (id) => !save.clubStints.some((st) => st.id === id),
  )
  if (missing.length > 0) {
    console.log(`    ⚠ IDs alvo não encontrados neste save (ignorados): ${missing.join(', ')}`)
  }

  if (!CONFIRM) {
    console.log('\n[dry-run] Nada foi alterado. Rode novamente com --confirm para aplicar.')
    return
  }

  if (toDelete.length === 0) {
    console.log('\n    Nada para apagar (já limpo ou IDs não conferem).')
    return
  }

  const ids = toDelete.map((s) => s.id)
  // Transfers referenciam clubStint via FK opcional; soltamos a FK antes de apagar.
  await prisma.$transaction([
    prisma.transfer.updateMany({
      where: { clubStintId: { in: ids } },
      data: { clubStintId: null },
    }),
    prisma.clubStint.deleteMany({ where: { id: { in: ids } } }),
  ])
  console.log(`\n    ✓ Apagados ${ids.length} stint(s): ${ids.join(', ')}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
