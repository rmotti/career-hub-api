import { describe, expect, it } from 'vitest'
import { AppError, NotFoundError } from '../errors.js'

describe('AppError', () => {
  it('sets default status code and error name', () => {
    const error = new AppError('Invalid input')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('AppError')
    expect(error.message).toBe('Invalid input')
    expect(error.statusCode).toBe(400)
    expect(error.code).toBeUndefined()
  })

  it('preserves custom status code and code', () => {
    const error = new AppError('Unauthorized', 401, 'UNAUTHORIZED')

    expect(error.statusCode).toBe(401)
    expect(error.code).toBe('UNAUTHORIZED')
  })
})

describe('NotFoundError', () => {
  it('uses 404 status code', () => {
    const error = new NotFoundError('Resource not found')

    expect(error).toBeInstanceOf(AppError)
    expect(error.name).toBe('NotFoundError')
    expect(error.statusCode).toBe(404)
  })
})
