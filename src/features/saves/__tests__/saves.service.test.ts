import { beforeEach, describe, expect, it, vi } from 'vitest'

const txMock = {
  save: { update: vi.fn(), delete: vi.fn() },
}

vi.mock('../../../shared/lib/prisma.js', () => ({
  prisma: {
    save: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock)),
  },
}))

vi.mock('../snapshots.service.js', () => ({
  createSnapshot: vi.fn(),
  writeAudit: vi.fn(),
}))

vi.mock('../../../shared/utils/cache.js', () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheInvalidate: vi.fn(),
  cacheInvalidatePattern: vi.fn(),
}))

import { prisma } from '../../../shared/lib/prisma.js'
import { createSnapshot, writeAudit } from '../snapshots.service.js'
import { deleteSave, restoreSave } from '../saves.service.js'

const mockedPrisma = prisma as unknown as {
  save: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }
  $transaction: ReturnType<typeof vi.fn>
}
const mockedCreateSnapshot = createSnapshot as unknown as ReturnType<typeof vi.fn>
const mockedWriteAudit = writeAudit as unknown as ReturnType<typeof vi.fn>

const SAVE_ID = 'save-1'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('deleteSave', () => {
  it('requires ?confirm=<saveId> — throws 400 and mutates nothing', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, userId: 'owner', deletedAt: null, name: 'x' })

    await expect(deleteSave(SAVE_ID, 'owner', { confirm: 'wrong' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'DELETE_CONFIRMATION_REQUIRED',
    })
    expect(txMock.save.update).not.toHaveBeenCalled()
    expect(txMock.save.delete).not.toHaveBeenCalled()
    expect(mockedCreateSnapshot).not.toHaveBeenCalled()
  })

  it('soft-deletes by default: takes a pre-delete snapshot and sets deletedAt', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, userId: 'owner', deletedAt: null, name: 'x' })

    const result = await deleteSave(SAVE_ID, 'owner', { confirm: SAVE_ID })

    expect(mockedCreateSnapshot).toHaveBeenCalledWith(txMock, SAVE_ID, 'owner', 'pre-delete')
    expect(txMock.save.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SAVE_ID }, data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    )
    expect(txMock.save.delete).not.toHaveBeenCalled()
    expect(result).toEqual({ purged: false })
  })

  it('purges with ?purge=true: hard-deletes and audits, no snapshot', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, userId: 'owner', deletedAt: null, name: 'x' })

    const result = await deleteSave(SAVE_ID, 'owner', { confirm: SAVE_ID, purge: true })

    expect(txMock.save.delete).toHaveBeenCalledWith({ where: { id: SAVE_ID } })
    expect(mockedWriteAudit).toHaveBeenCalledWith(txMock, expect.objectContaining({ action: 'save.purge' }))
    expect(mockedCreateSnapshot).not.toHaveBeenCalled()
    expect(result).toEqual({ purged: true })
  })

  it('is idempotent on an already-archived save (no second snapshot)', async () => {
    const deletedAt = new Date()
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, userId: 'owner', deletedAt, name: 'x' })

    const result = await deleteSave(SAVE_ID, 'owner', { confirm: SAVE_ID })

    expect(result).toEqual({ purged: false, deletedAt })
    expect(mockedCreateSnapshot).not.toHaveBeenCalled()
    expect(txMock.save.update).not.toHaveBeenCalled()
  })

  it('blocks IDOR: 404 when the save belongs to another user (before the confirm check)', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, userId: 'owner', deletedAt: null, name: 'x' })

    await expect(deleteSave(SAVE_ID, 'attacker', { confirm: SAVE_ID })).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('restoreSave', () => {
  it('un-archives a soft-deleted save (clears deletedAt) + audits', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, userId: 'owner', deletedAt: new Date() })

    await restoreSave(SAVE_ID, 'owner')

    expect(txMock.save.update).toHaveBeenCalledWith({ where: { id: SAVE_ID }, data: { deletedAt: null } })
    expect(mockedWriteAudit).toHaveBeenCalledWith(txMock, expect.objectContaining({ action: 'save.restore' }))
  })

  it('rejects with 400 when the save is not archived', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, userId: 'owner', deletedAt: null })

    await expect(restoreSave(SAVE_ID, 'owner')).rejects.toMatchObject({ statusCode: 400 })
    expect(txMock.save.update).not.toHaveBeenCalled()
  })

  it('blocks IDOR: 404 for a save owned by someone else', async () => {
    mockedPrisma.save.findUnique.mockResolvedValue({ id: SAVE_ID, userId: 'owner', deletedAt: new Date() })

    await expect(restoreSave(SAVE_ID, 'attacker')).rejects.toMatchObject({ statusCode: 404 })
  })
})
