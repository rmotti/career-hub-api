/**
 * Invalida todas as chaves de cache de um save (e a lista de saves do usuário dono).
 *   npx tsx --env-file=.env.local scripts/flush-save-cache.ts <saveId> [userId]
 */
import { redis } from '../src/shared/lib/redis.js'
import { cacheInvalidatePattern, cacheInvalidate } from '../src/shared/utils/cache.js'

const saveId = process.argv[2]
const userId = process.argv[3]

if (!saveId) {
  console.error('Uso: tsx scripts/flush-save-cache.ts <saveId> [userId]')
  process.exit(1)
}

async function main() {
  await cacheInvalidatePattern(`save:${saveId}*`)
  await cacheInvalidate(`save:${saveId}`)
  if (userId) await cacheInvalidate(`user:${userId}:saves`)
  console.log(`✓ Cache limpo para save ${saveId}${userId ? ` e lista de ${userId}` : ''}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => redis.quit())
