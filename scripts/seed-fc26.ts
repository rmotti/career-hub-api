import { PrismaClient } from '@prisma/client'
import { createReadStream } from 'fs'
import { resolve } from 'path'
import { parse } from 'csv-parse'

const prisma = new PrismaClient()
const BATCH_SIZE = 500

async function main() {
  const filePath = resolve(process.cwd(), 'data/fc26-clean.csv')
  const records: any[] = []

  await new Promise<void>((res, rej) => {
    createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true }))
      .on('data', (row) => records.push(row))
      .on('end', res)
      .on('error', rej)
  })

  console.log(`Lidos ${records.length} jogadores do CSV`)

  let inserted = 0
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)

    await Promise.all(
      batch.map((row) => {
        const positions = row.positions
          ? row.positions.replace(/[\[\]']/g, '').split(', ').filter(Boolean)
          : []

        return prisma.fc26Player.upsert({
          where: { sofifaId: Number(row.sofifaId) },
          update: {
            name: row.name,
            positions,
            age: Number(row.age),
            ovr: Number(row.ovr),
            potential: Number(row.potential),
            marketValue: row.marketValue ? Number(row.marketValue) : null,
            nation: row.nation || null,
            club: row.club || null,
            league: row.league || null,
            wage: row.wage ? Number(row.wage) : null,
          },
          create: {
            sofifaId: Number(row.sofifaId),
            name: row.name,
            positions,
            age: Number(row.age),
            ovr: Number(row.ovr),
            potential: Number(row.potential),
            marketValue: row.marketValue ? Number(row.marketValue) : null,
            nation: row.nation || null,
            club: row.club || null,
            league: row.league || null,
            wage: row.wage ? Number(row.wage) : null,
          },
        })
      })
    )

    inserted += batch.length
    console.log(`Progresso: ${inserted}/${records.length}`)
  }

  console.log(`Concluído: ${inserted} jogadores inseridos/atualizados`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
