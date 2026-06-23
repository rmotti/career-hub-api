import { describe, expect, it } from 'vitest'
import { FORMATION_NAMES, normalizeFormation } from '../formations.js'

describe('normalizeFormation', () => {
  it('resolves the hyphenated canonical form', () => {
    expect(normalizeFormation('3-4-2-1')).toBe('3-4-2-1')
    expect(normalizeFormation('4-3-3')).toBe('4-3-3')
  })

  it('resolves digit-only forms the chat surface speaks', () => {
    expect(normalizeFormation('3421')).toBe('3-4-2-1')
    expect(normalizeFormation('352')).toBe('3-5-2')
    expect(normalizeFormation('433')).toBe('4-3-3')
  })

  it('ignores arbitrary separators and whitespace', () => {
    expect(normalizeFormation('3 4 2 1')).toBe('3-4-2-1')
    expect(normalizeFormation(' 3/4/2/1 ')).toBe('3-4-2-1')
  })

  it('returns undefined for empty / missing input (caller falls back to default)', () => {
    expect(normalizeFormation(undefined)).toBeUndefined()
    expect(normalizeFormation('')).toBeUndefined()
    expect(normalizeFormation('abc')).toBeUndefined()
  })

  it('returns undefined for an unsupported shape so the tool can report it', () => {
    expect(normalizeFormation('9-9-9')).toBeUndefined()
  })

  it('resolves every supported formation by its exact name', () => {
    for (const name of FORMATION_NAMES) {
      expect(normalizeFormation(name)).toBe(name)
    }
  })

  it('a digit string resolves to the first shape with that signature (named variants need the name)', () => {
    // "4-4-2" and "4-4-2 Diamante" share the digits "442"; the plain shape wins on digits alone,
    // and the diamond stays reachable only by its full name.
    expect(normalizeFormation('442')).toBe('4-4-2')
    expect(normalizeFormation('4-4-2 Diamante')).toBe('4-4-2 Diamante')
  })
})
