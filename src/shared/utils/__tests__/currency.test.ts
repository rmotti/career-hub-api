import { describe, expect, it } from 'vitest'
import { formatBalance, formatMarketValue, formatSalary, millions, thousands } from '../currency.js'

describe('currency formatters', () => {
  it('formats nullish market values as empty display values', () => {
    expect(formatMarketValue(millions(null))).toBe('—')
    expect(formatMarketValue(millions(undefined))).toBe('—')
  })

  it('formats market values in millions and thousands', () => {
    expect(formatMarketValue(millions(35))).toBe('€35M')
    expect(formatMarketValue(millions(0.9))).toBe('€900K')
  })

  it('formats salaries in thousands', () => {
    expect(formatSalary(thousands(75))).toBe('€75K')
    expect(formatSalary(thousands(null))).toBe('—')
  })

  it('uses market value formatting for balances', () => {
    expect(formatBalance(millions(12))).toBe('€12M')
    expect(formatBalance(millions(0.35))).toBe('€350K')
  })

  it('brand constructors preserve null/undefined and pass values through', () => {
    expect(millions(null)).toBeNull()
    expect(thousands(undefined)).toBeNull()
    expect(millions(0)).toBe(0)
    expect(thousands(75)).toBe(75)
  })
})
