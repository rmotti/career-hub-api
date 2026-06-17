import { CLUBS_BY_LEAGUE, LEAGUE_TO_COUNTRY, CLUBS_DATA_VERSION } from './clubs.data.js'

// The club list lives as static data in ./clubs.data.ts (separated so a new-season
// refresh is a self-contained data diff). Re-exported here so callers keep importing from
// the service — the public surface is unchanged.
export { CLUBS_BY_LEAGUE, LEAGUE_TO_COUNTRY, CLUBS_DATA_VERSION }

export const CLUBS: string[] = Object.values(CLUBS_BY_LEAGUE).flat()

export function getAllClubs(): string[] {
  return CLUBS
}

export function getClubsByLeague(league: string): string[] | undefined {
  return CLUBS_BY_LEAGUE[league]
}

export function clubExists(club: string): boolean {
  return CLUBS.includes(club)
}

export function findLeagueByClub(club: string): string | null {
  // First match wins. Some club names exist in more than one league (e.g. a men's and a
  // women's team share a name) — the men's league is listed first, preserving prior behaviour.
  for (const [league, clubs] of Object.entries(CLUBS_BY_LEAGUE)) {
    if (clubs.includes(club)) return league
  }
  return null
}
