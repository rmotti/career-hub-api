import { PrismaClient, Position, PlayerStatus, TransferType } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  const save = await prisma.save.create({
    data: {
      name: 'My Career',
      currentYear: 2026,
      currentSeason: '2026/27',
    },
  })

  const stint = await prisma.clubStint.create({
    data: {
      saveId: save.id,
      club: 'Liverpool',
      startYear: '2026',
      isCurrent: true,
    },
  })

  await prisma.teamSeasonStats.create({
    data: {
      clubStintId: stint.id,
      season: '2026/27',
      goalsPro: 45,
      goalsAgainst: 20,
      possession: 58,
      wins: 18,
      draws: 5,
      losses: 3,
    },
  })

  const player = await prisma.player.create({
    data: {
      saveId: save.id,
      activeClubStintId: stint.id,
      name: 'Mohamed Salah',
      position: Position.ATA,
      age: 34,
      status: PlayerStatus.Crucial,
      ovr: 91,
      salary: '£350,000/w',
      marketValue: '£60M',
    },
  })

  await prisma.playerSeasonStats.create({
    data: {
      playerId: player.id,
      clubStintId: stint.id,
      season: '2026/27',
      goals: 18,
      assists: 9,
      yellowCards: 2,
      redCards: 0,
    },
  })

  await prisma.trophy.create({
    data: {
      clubStintId: stint.id,
      name: 'Premier League',
      year: 2027,
    },
  })

  await prisma.transfer.create({
    data: {
      saveId: save.id,
      playerId: player.id,
      playerName: 'Mohamed Salah',
      type: TransferType.compra,
      from: 'Free Agent',
      to: 'Liverpool',
      fee: 'Free',
      season: '2026/27',
    },
  })

  console.log('Seed completed!')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
