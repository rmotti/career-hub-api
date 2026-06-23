import { describe, expect, it } from 'vitest'
import { toFc26DatasetClubName } from '../fc26-import-club-name.js'

describe('toFc26DatasetClubName', () => {
  it('resolves app club names to the FC26 dataset names used for squad import', () => {
    // The original bug: app stores "Bayer Leverkusen", dataset has "Bayer 04 Leverkusen".
    expect(toFc26DatasetClubName('Bayer Leverkusen')).toBe('Bayer 04 Leverkusen')
    expect(toFc26DatasetClubName('Bayern Munich')).toBe('FC Bayern München')
    expect(toFc26DatasetClubName('Fulham')).toBe('Fulham FC')
    expect(toFc26DatasetClubName('Sporting KC')).toBe('Sporting Kansas City')
  })

  it('returns the input unchanged when it already matches the dataset', () => {
    expect(toFc26DatasetClubName('Manchester United')).toBe('Manchester United')
    expect(toFc26DatasetClubName('Arsenal')).toBe('Arsenal')
  })

  it('returns the input unchanged for clubs with no FC26 source data', () => {
    // Santos exists in the app's Série A but is not in FC26's licensed subset.
    expect(toFc26DatasetClubName('Santos')).toBe('Santos')
    // Unknown club -> no league -> passthrough.
    expect(toFc26DatasetClubName('Not A Real Club')).toBe('Not A Real Club')
  })
})
