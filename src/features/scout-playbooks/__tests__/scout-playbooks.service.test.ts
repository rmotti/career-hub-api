import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../shared/lib/prisma.js', () => ({
  prisma: {
    save: { findFirst: vi.fn(), findUnique: vi.fn() },
    scoutPlaybook: { findFirst: vi.fn() },
  },
}))

vi.mock('../../fc26-players/fc26-players.service.js', () => ({
  listFc26Players: vi.fn(),
}))

import { prisma } from '../../../shared/lib/prisma.js'
import { listFc26Players } from '../../fc26-players/fc26-players.service.js'
import { evaluateScoutPlayers } from '../scout-playbooks.service.js'

const mockedPrisma = prisma as unknown as {
  save: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> }
  scoutPlaybook: { findFirst: ReturnType<typeof vi.fn> }
}

const marketOnly = { overall: 0, age: 0, historicalFit: 0, potential: 0, marketValue: 1 }

function datasetPlayer(overrides: Record<string, unknown> = {}) {
  return { sofifaId: 1, ovr: 80, potential: 84, age: 24, marketValue: 30, wage: 50, ...overrides }
}

beforeEach(() => {
  mockedPrisma.save.findFirst.mockReset().mockResolvedValue({ id: 's1' }) // assertSaveAccess passes
  mockedPrisma.save.findUnique.mockReset()
  mockedPrisma.scoutPlaybook.findFirst.mockReset()
  vi.mocked(listFc26Players).mockReset().mockResolvedValue({ players: [datasetPlayer()], total: 1, limit: 20, offset: 0 } as never)
})

describe('evaluateScoutPlayers — budget orchestration', () => {
  it('passes an explicit cap to the dataset query (hard filter) and uses it as the gradient ref', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ budget: 200 })

    const result = await evaluateScoutPlayers(
      { saveId: 's1', playbook: { weights: marketOnly, preferences: { maxMarketValue: 60 } } },
      'u1',
    )

    expect(vi.mocked(listFc26Players)).toHaveBeenCalledWith(expect.objectContaining({ maxMarketValue: 60, saveId: 's1' }))
    // marketValue 30 against the cap 60 → 100 × (1 − 30/60) = 50
    expect(result.players[0].scoutScore).toBe(50)
  })

  it('falls back to the save budget as the ref when no cap is set, and passes no cap to the query', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ budget: 100 })
    mockedPrisma.scoutPlaybook.findFirst.mockResolvedValue(null) // → built-in default playbook

    const result = await evaluateScoutPlayers({ saveId: 's1' }, 'u1')

    expect(vi.mocked(listFc26Players).mock.calls[0][0]).not.toHaveProperty('maxMarketValue')
    // marketValue 30 against the budget 100 → 100 × (1 − 30/100) = 70
    const market = result.players[0].scoutScoreBreakdown.find((i) => i.key === 'marketValue')
    expect(market).toMatchObject({ available: true, score: 70 })
  })

  it('drops marketValue when there is neither a cap nor a save budget', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ budget: null })

    const result = await evaluateScoutPlayers(
      { saveId: 's1', playbook: { weights: marketOnly } },
      'u1',
    )

    expect(result.players[0].scoutScore).toBeNull()
    expect(result.players[0].scoutScoreBreakdown.find((i) => i.key === 'marketValue')).toMatchObject({ available: false })
  })
})
