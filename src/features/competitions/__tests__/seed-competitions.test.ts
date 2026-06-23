import { describe, expect, it } from 'vitest'
import { LEAGUE_TO_COUNTRY } from '../../clubs/clubs.data.js'
import { DOMESTIC, EUROPEAN, buildCompetitions } from '../../../../prisma/seed-competitions.js'

// Guards the F-005 contract: the competition seed must cover every country that has selectable
// clubs, otherwise a save created for one of its clubs would track no league/cup. This is the
// regression test that stops a roster update from silently re-opening the coverage gap.
describe('seed-competitions coverage', () => {
  const countriesWithClubs = [...new Set(Object.values(LEAGUE_TO_COUNTRY).filter(Boolean))]

  it('defines competitions for every country that has selectable clubs', () => {
    const missing = countriesWithClubs.filter((c) => !DOMESTIC[c])
    expect(missing, `countries with clubs but no competitions: ${missing.join(', ')}`).toEqual([])
  })

  it('gives every covered country at least one League competition', () => {
    for (const country of countriesWithClubs) {
      const hasLeague = (DOMESTIC[country] ?? []).some((c) => c.type === 'League')
      expect(hasLeague, `country "${country}" has no League competition`).toBe(true)
    }
  })

  it('builds a flat list with unique names and correct country wiring', () => {
    const all = buildCompetitions()
    const names = all.map((c) => c.name)
    expect(new Set(names).size, 'competition names must be unique (Competition.name @unique)').toBe(names.length)

    // European cups are continent-wide (country: null); domestic ones always carry a country.
    expect(EUROPEAN.every((c) => c.country === null && c.type === 'EuropeanCup')).toBe(true)
    expect(all.filter((c) => c.type !== 'EuropeanCup').every((c) => typeof c.country === 'string')).toBe(true)
  })
})
