import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const deleted = await prisma.user.deleteMany({
    where: { email: { contains: 'loadtest+' } },
  })

  console.log(`${deleted.count} usuários de teste removidos.`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
