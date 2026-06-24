import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../shared/lib/prisma.js', () => ({
  prisma: { save: { findFirst: vi.fn() } },
}))

import { prisma } from '../../shared/lib/prisma.js'
import { resolveSaveId } from '../utils.js'

const findFirst = vi.mocked(prisma.save.findFirst)

describe('resolveSaveId', () => {
  beforeEach(() => {
    findFirst.mockReset()
  })

  it('uses a model-supplied saveId when the user owns it', async () => {
    findFirst.mockResolvedValueOnce({ id: 'save-given' } as never)

    const id = await resolveSaveId('user-1', 'save-given', 'save-pinned')

    expect(id).toBe('save-given')
    // The ownership lookup is scoped to the user — a bare findUnique by id would leak other saves.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'save-given', userId: 'user-1' } }),
    )
  })

  it('ignores a bogus/unowned saveId and falls back to the pinned save', async () => {
    findFirst.mockResolvedValueOnce(null) // ownership check fails

    const id = await resolveSaveId('user-1', 'save-hallucinated', 'save-pinned')

    expect(id).toBe('save-pinned')
  })

  it('falls back to the most-recent save when given is unowned and there is no pinned save', async () => {
    findFirst
      .mockResolvedValueOnce(null) // ownership check on given fails
      .mockResolvedValueOnce({ id: 'save-recent' } as never) // most-recent lookup

    const id = await resolveSaveId('user-1', 'save-hallucinated', undefined)

    expect(id).toBe('save-recent')
  })

  it('uses the pinned save when no saveId is given', async () => {
    const id = await resolveSaveId('user-1', undefined, 'save-pinned')

    expect(id).toBe('save-pinned')
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('returns null when the user has no saves at all', async () => {
    findFirst.mockResolvedValueOnce(null) // most-recent lookup

    const id = await resolveSaveId('user-1', undefined, undefined)

    expect(id).toBeNull()
  })
})
