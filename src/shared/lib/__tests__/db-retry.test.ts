import { describe, expect, it, vi } from 'vitest'
import { PrismaClientKnownRequestError, PrismaClientInitializationError } from '@prisma/client/runtime/library'
import { isTransientDbError, withDbRetry } from '../db-retry.js'

function knownError(code: string): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError('boom', { code, clientVersion: '5.x' })
}

describe('isTransientDbError', () => {
  it('flags infra-level transient codes', () => {
    for (const code of ['P1001', 'P1002', 'P1008', 'P1017', 'P2024']) {
      expect(isTransientDbError(knownError(code))).toBe(true)
    }
  })

  it('flags initialization errors', () => {
    expect(isTransientDbError(new PrismaClientInitializationError('no db', '5.x'))).toBe(true)
  })

  it('does not flag data/client errors', () => {
    for (const code of ['P2025', 'P2002', 'P2003']) {
      expect(isTransientDbError(knownError(code))).toBe(false)
    }
    expect(isTransientDbError(new Error('plain'))).toBe(false)
  })
})

describe('withDbRetry', () => {
  it('returns the result without retrying on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    await expect(withDbRetry(fn)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on a pool timeout (P2024) then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(knownError('P2024'))
      .mockResolvedValueOnce('recovered')
    await expect(withDbRetry(fn, { baseDelayMs: 0 })).resolves.toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('gives up after the retry budget and rethrows the pool timeout', async () => {
    const fn = vi.fn().mockRejectedValue(knownError('P2024'))
    await expect(withDbRetry(fn, { retries: 2, baseDelayMs: 0 })).rejects.toMatchObject({ code: 'P2024' })
    expect(fn).toHaveBeenCalledTimes(3) // initial + 2 retries
  })

  it('does NOT retry a mid-flight drop (P1017) — ambiguous for writes', async () => {
    const fn = vi.fn().mockRejectedValue(knownError('P1017'))
    await expect(withDbRetry(fn, { baseDelayMs: 0 })).rejects.toMatchObject({ code: 'P1017' })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry non-transient errors', async () => {
    const fn = vi.fn().mockRejectedValue(knownError('P2002'))
    await expect(withDbRetry(fn, { baseDelayMs: 0 })).rejects.toMatchObject({ code: 'P2002' })
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
