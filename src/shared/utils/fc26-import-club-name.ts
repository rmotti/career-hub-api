import { FC26_IMPORT_CLUB_NAME_BY_LEAGUE } from './fc26-import-club-aliases.generated.js'
import { findLeagueByClub } from '../../features/clubs/clubs.service.js'

/**
 * Resolves an app club name (as stored on ClubStint.club, sourced from
 * clubs.data.ts) to the name used in the FC26 player dataset (Fc26Player.club).
 *
 * The app's curated names and the FC26 source CSV diverge for the same club
 * ("Bayer Leverkusen" vs "Bayer 04 Leverkusen"), so a direct match on
 * Fc26Player.club silently finds nothing. The alias map is keyed by league
 * because some app names are reused across men's/women's competitions; the
 * league is derived from the club itself via findLeagueByClub.
 *
 * Returns the dataset name when an alias exists, otherwise the input unchanged
 * (the club already matches the dataset, or has no FC26 source data).
 */
export function toFc26DatasetClubName(appClub: string): string {
  const league = findLeagueByClub(appClub)
  if (league) {
    const alias = FC26_IMPORT_CLUB_NAME_BY_LEAGUE[league]?.[appClub]
    if (alias) return alias
  }
  return appClub
}
