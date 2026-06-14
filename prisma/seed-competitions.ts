import { PrismaClient, CompetitionType } from '@prisma/client'

const prisma = new PrismaClient()

const COMPETITIONS: { name: string; type: CompetitionType; country: string | null }[] = [
  { name: 'Premier League',             type: 'League',      country: 'England' },
  { name: 'FA Cup',                     type: 'NationalCup', country: 'England' },
  { name: 'Carabao Cup',               type: 'NationalCup', country: 'England' },
  { name: 'FA Community Shield',        type: 'SuperCup',    country: 'England' },
  { name: 'Ligue 1',                    type: 'League',      country: 'France'  },
  { name: 'Coupe de France',            type: 'NationalCup', country: 'France'  },
  { name: 'Trophée des Champions',      type: 'SuperCup',    country: 'France'  },
  { name: 'Bundesliga',                 type: 'League',      country: 'Germany' },
  { name: 'DFB-Pokal',                  type: 'NationalCup', country: 'Germany' },
  { name: 'Franz Beckenbauer Supercup', type: 'SuperCup',    country: 'Germany' },
  { name: 'Serie A',                    type: 'League',      country: 'Italy'   },
  { name: 'Coppa Italia',               type: 'NationalCup', country: 'Italy'   },
  { name: 'Supercoppa Italiana',        type: 'SuperCup',    country: 'Italy'   },
  { name: 'La Liga',                    type: 'League',      country: 'Spain'   },
  { name: 'Copa del Rey',               type: 'NationalCup', country: 'Spain'   },
  { name: 'Supercopa de España',        type: 'SuperCup',    country: 'Spain'   },
  { name: 'UEFA Champions League',      type: 'EuropeanCup', country: null      },
  { name: 'UEFA Europa League',         type: 'EuropeanCup', country: null      },
  { name: 'UEFA Conference League',     type: 'EuropeanCup', country: null      },
  { name: 'UEFA Super Cup',             type: 'EuropeanCup', country: null      },
]

async function main() {
  console.log('Seeding competitions...')

  for (const comp of COMPETITIONS) {
    await prisma.competition.upsert({
      where: { name: comp.name },
      create: comp,
      update: {},
    })
  }

  console.log(`✓ ${COMPETITIONS.length} competitions seeded.`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
