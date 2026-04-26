import { PrismaClient } from '@prisma/client'
import { hashPassword } from '@better-auth/utils/password'
import { randomBytes } from 'node:crypto'

const prisma = new PrismaClient()
const TOTAL_USERS = 200
const PASSWORD = 'loadtest123'
const BATCH_SIZE = 20

async function main() {
  console.log(`\nSeed direto no banco — ${TOTAL_USERS} usuários\n`)

  const hashed = await hashPassword(PASSWORD)
  let created = 0
  let skipped = 0

  for (let i = 0; i < TOTAL_USERS; i += BATCH_SIZE) {
    const batch = Array.from({ length: Math.min(BATCH_SIZE, TOTAL_USERS - i) }, (_, j) => i + j + 1)

    await Promise.all(batch.map(async (index) => {
      const email = `loadtest+${index}@careerhub.test`

      const existing = await prisma.user.findUnique({ where: { email } })
      if (existing) {
        console.log(`~ Já existe: ${email}`)
        skipped++
        return
      }

      const userId = randomBytes(16).toString('hex')
      const accountId = randomBytes(16).toString('hex')

      await prisma.$transaction([
        prisma.user.create({
          data: {
            id: userId,
            name: `LoadTest User ${index}`,
            email,
            emailVerified: true,
            role: 'user',
            plan: 'FREE',
            banned: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
        prisma.account.create({
          data: {
            id: accountId,
            accountId: userId,
            providerId: 'credential',
            userId,
            password: hashed,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      ])

      console.log(`✓ Criado: ${email}`)
      created++
    }))
  }

  console.log(`\n${created} criados, ${skipped} já existiam, total ${created + skipped}/${TOTAL_USERS}`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
