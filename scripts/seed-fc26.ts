import { PrismaClient } from '@prisma/client'
import { createReadStream } from 'fs'
import { resolve } from 'path'
import { parse } from 'csv-parse'

const prisma = new PrismaClient()
const BATCH_SIZE = 500

function toInt(val: string): number | null {
  if (!val || val.trim() === '') return null
  const n = Math.round(parseFloat(val))
  return isNaN(n) ? null : n
}

function toFloat(val: string): number | null {
  if (!val || val.trim() === '') return null
  const n = parseFloat(val)
  return isNaN(n) ? null : n
}

function toStrArr(val: string): string[] {
  if (!val || val.trim() === '') return []
  return val.split(',').map((s) => s.trim()).filter(Boolean)
}

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

        const playerTags = toStrArr(row.player_tags)
        const playerTraits = toStrArr(row.player_traits)

        const data = {
          name: row.name,
          longName: row.long_name || null,
          positions,
          age: Number(row.age),
          dob: row.dob || null,
          height: toInt(row.height_cm),
          weight: toInt(row.weight_kg),
          ovr: Number(row.ovr),
          potential: Number(row.potential),
          marketValue: toFloat(row.marketValue),
          nation: row.nation || null,
          club: row.club || null,
          league: row.league || null,
          wage: toFloat(row.wage),
          playerFaceUrl: row.player_face_url || null,

          contractUntil: toInt(row.club_contract_valid_until_year),
          releaseClause: row.release_clause_eur ? toFloat(row.release_clause_eur) && toFloat(row.release_clause_eur)! / 1_000_000 : null,

          preferredFoot: row.preferred_foot || null,
          weakFoot: toInt(row.weak_foot),
          skillMoves: toInt(row.skill_moves),
          internationalReputation: toInt(row.international_reputation),
          workRate: row.work_rate || null,
          bodyType: row.body_type || null,
          playerTags,
          playerTraits,

          pace: toInt(row.pace),
          shooting: toInt(row.shooting),
          passing: toInt(row.passing),
          dribbling: toInt(row.dribbling),
          defending: toInt(row.defending),
          physic: toInt(row.physic),

          attackingCrossing: toInt(row.attacking_crossing),
          attackingFinishing: toInt(row.attacking_finishing),
          attackingHeadingAccuracy: toInt(row.attacking_heading_accuracy),
          attackingShortPassing: toInt(row.attacking_short_passing),
          attackingVolleys: toInt(row.attacking_volleys),

          skillDribbling: toInt(row.skill_dribbling),
          skillCurve: toInt(row.skill_curve),
          skillFkAccuracy: toInt(row.skill_fk_accuracy),
          skillLongPassing: toInt(row.skill_long_passing),
          skillBallControl: toInt(row.skill_ball_control),

          movementAcceleration: toInt(row.movement_acceleration),
          movementSprintSpeed: toInt(row.movement_sprint_speed),
          movementAgility: toInt(row.movement_agility),
          movementReactions: toInt(row.movement_reactions),
          movementBalance: toInt(row.movement_balance),

          powerShotPower: toInt(row.power_shot_power),
          powerJumping: toInt(row.power_jumping),
          powerStamina: toInt(row.power_stamina),
          powerStrength: toInt(row.power_strength),
          powerLongShots: toInt(row.power_long_shots),

          mentalityAggression: toInt(row.mentality_aggression),
          mentalityInterceptions: toInt(row.mentality_interceptions),
          mentalityPositioning: toInt(row.mentality_positioning),
          mentalityVision: toInt(row.mentality_vision),
          mentalityPenalties: toInt(row.mentality_penalties),
          mentalityComposure: toInt(row.mentality_composure),

          defendingMarkingAwareness: toInt(row.defending_marking_awareness),
          defendingStandingTackle: toInt(row.defending_standing_tackle),
          defendingSlidingTackle: toInt(row.defending_sliding_tackle),

          goalkeepingDiving: toInt(row.goalkeeping_diving),
          goalkeepingHandling: toInt(row.goalkeeping_handling),
          goalkeepingKicking: toInt(row.goalkeeping_kicking),
          goalkeepingPositioning: toInt(row.goalkeeping_positioning),
          goalkeepingReflexes: toInt(row.goalkeeping_reflexes),
          goalkeepingSpeed: toInt(row.goalkeeping_speed),
        }

        return prisma.fc26Player.upsert({
          where: { sofifaId: Number(row.sofifaId) },
          update: data,
          create: { sofifaId: Number(row.sofifaId), ...data },
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
