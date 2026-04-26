import { describe, expect, it } from 'vitest'
import { formatBalance, formatMarketValue, formatSalary } from '../currency.js'

describe('currency formatters', () => {
  it('formats nullish market values as empty display values', () => {
    expect(formatMarketValue(null)).toBe('—')
    expect(formatMarketValue(undefined)).toBe('—')
  })

  it('formats market values in millions and thousands', () => {
    expect(formatMarketValue(35)).toBe('€35M')
    expect(formatMarketValue(0.9)).toBe('€900K')
  })

  it('formats salaries in thousands', () => {
    expect(formatSalary(75)).toBe('€75K')
    expect(formatSalary(null)).toBe('—')
  })

  it('uses market value formatting for balances', () => {
    expect(formatBalance(12)).toBe('€12M')
    expect(formatBalance(0.35)).toBe('€350K')
  })
})
