import { describe, expect, it } from 'vitest'
import {
  CLUBS,
  CLUBS_BY_LEAGUE,
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
})
