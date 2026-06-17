import { describe, expect, it } from 'vitest'
import {
  CLUBS,
  CLUBS_BY_LEAGUE,
  CLUBS_DATA_VERSION,
  LEAGUE_TO_COUNTRY,
  clubExists,
  findLeagueByClub,
  getAllClubs,
  getClubsByLeague,
} from '../clubs.service.js'

describe('clubs service', () => {
  it('returns all clubs from the configured leagues', () => {
    expect(getAllClubs()).toBe(CLUBS)
    expect(getAllClubs()).toContain('Liverpool')
    expect(getAllClubs()).toContain('Real Madrid')
  })

  it('returns clubs by league', () => {
    expect(getClubsByLeague('Premier League')).toBe(CLUBS_BY_LEAGUE['Premier League'])
    expect(getClubsByLeague('Unknown League')).toBeUndefined()
  })

  it('checks whether a club exists', () => {
    expect(clubExists('FC Barcelona')).toBe(true)
    expect(clubExists('Made Up FC')).toBe(false)
  })

  it('finds the league for a known club', () => {
    expect(findLeagueByClub('Manchester City')).toBe('Premier League')
    expect(findLeagueByClub('Bayern Munich')).toBe('Bundesliga')
    expect(findLeagueByClub('Made Up FC')).toBeNull()
  })

  describe('data consistency (clubs.data.ts)', () => {
    it('has a version stamp', () => {
      expect(CLUBS_DATA_VERSION).toMatch(/^\d{4}\/\d{2}$/)
    })

    it('keeps CLUBS_BY_LEAGUE and LEAGUE_TO_COUNTRY league keys in sync', () => {
      const clubLeagues = Object.keys(CLUBS_BY_LEAGUE).sort()
      const countryLeagues = Object.keys(LEAGUE_TO_COUNTRY).sort()
      // Every league with clubs must map to a country (findLeagueByClub → LEAGUE_TO_COUNTRY)
      // and vice-versa — a league in one map but not the other is a data-entry mistake.
      expect(clubLeagues).toEqual(countryLeagues)
    })

    it('has no empty leagues and CLUBS is the flattened union', () => {
      for (const [league, clubs] of Object.entries(CLUBS_BY_LEAGUE)) {
        expect(clubs.length, `league "${league}" is empty`).toBeGreaterThan(0)
      }
      expect(CLUBS.length).toBe(Object.values(CLUBS_BY_LEAGUE).reduce((n, c) => n + c.length, 0))
    })
  })
})
