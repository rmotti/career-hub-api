import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyReply, FastifyRequest } from 'fastify'

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    save: { findFirst: vi.fn() },
  },
}))

import { prisma } from '../../lib/prisma.js'
import { AppError, NotFoundError } from '../errors.js'
import { assertSaveAccess, requireSaveOwnership } from '../save-access.js'

const mockedPrisma = prisma as unknown as {
  save: { findFirst: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  mockedPrisma.save.findFirst.mockReset()
})

const reply = {} as FastifyReply

describe('assertSaveAccess', () => {
  it('resolves when the save belongs to the user', async () => {
    mockedPrisma.save.findFirst.mockResolvedValue({ id: 's1' })

    await expect(assertSaveAccess('s1', 'owner')).resolves.toBeUndefined()
  })

  it('scopes the lookup by both id and userId', async () => {
    mockedPrisma.save.findFirst.mockResolvedValue({ id: 's1' })

    await assertSaveAccess('s1', 'owner')

    expect(mockedPrisma.save.findFirst).toHaveBeenCalledWith({
      where: { id: 's1', userId: 'owner' },
      select: { id: true },
    })
  })

  it('throws 404 (not 403) when the save is not owned by the user', async () => {
    mockedPrisma.save.findFirst.mockResolvedValue(null)

    await expect(assertSaveAccess('s1', 'attacker')).rejects.toMatchObject({
      name: 'NotFoundError',
      statusCode: 404,
    })
  })
})

describe('requireSaveOwnership preHandler', () => {
  function makeRequest(user: { id: string } | undefined, params: Record<string, string>) {
    return { user, params } as unknown as FastifyRequest
  }

  it('rejects with 401 when no authenticated user is present', async () => {
    const hook = requireSaveOwnership()

    await expect(hook(makeRequest(undefined, { saveId: 's1' }), reply)).rejects.toMatchObject({
      statusCode: 401,
    })
    expect(mockedPrisma.save.findFirst).not.toHaveBeenCalled()
  })

  it('passes when the authenticated user owns the save', async () => {
    mockedPrisma.save.findFirst.mockResolvedValue({ id: 's1' })
    const hook = requireSaveOwnership()

    await expect(hook(makeRequest({ id: 'owner' }, { saveId: 's1' }), reply)).resolves.toBeUndefined()
    expect(mockedPrisma.save.findFirst).toHaveBeenCalledWith({
      where: { id: 's1', userId: 'owner' },
      select: { id: true },
    })
  })

  it('blocks IDOR: 404 when the user does not own the requested saveId', async () => {
    mockedPrisma.save.findFirst.mockResolvedValue(null)
    const hook = requireSaveOwnership()

    await expect(hook(makeRequest({ id: 'attacker' }, { saveId: 'victim-save' }), reply)).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('is a no-op (no DB hit) when the route has no saveId param', async () => {
    const hook = requireSaveOwnership()

    await expect(hook(makeRequest({ id: 'owner' }, {}), reply)).resolves.toBeUndefined()
    expect(mockedPrisma.save.findFirst).not.toHaveBeenCalled()
  })

  it('throws an AppError (handled by the global error handler) on auth failure', async () => {
    const hook = requireSaveOwnership()

    await expect(hook(makeRequest(undefined, { saveId: 's1' }), reply)).rejects.toBeInstanceOf(AppError)
  })
})
