import { describe, expect, it } from 'vitest'
import { toFitScoreClubName, toLeagueCode, toNationality } from '../fit-score-maps.js'

describe('fit score maps', () => {
  it('maps FC26 league names to fit-score service codes', () => {
    expect(toLeagueCode('Premier League')).toBe('GB1')
    expect(toLeagueCode('La Liga')).toBe('ES1')
    expect(toLeagueCode('Unknown League')).toBeNull()
  })

  it('maps nationality aliases used by the fit-score service', () => {
    expect(toNationality('Korea Republic')).toBe('Korea, South')
    expect(toNationality('Brazil')).toBe('Brazil')
  })

  it('maps app club names to fit-score service names', () => {
    expect(toFitScoreClubName('FC Barcelona')).toBe('Barcelona')
    expect(toFitScoreClubName('Manchester City')).toBe('Man City')
    expect(toFitScoreClubName('Manchester United')).toBe('Man Utd')
    expect(toFitScoreClubName('Paris Saint-Germain')).toBe('PSG')
    expect(toFitScoreClubName('Atlético de Madrid')).toBe('Atlético Madrid')
    expect(toFitScoreClubName('Liverpool')).toBe('Liverpool')
  })

  it('uses league context for ambiguous club names', () => {
    expect(toFitScoreClubName('Inter Miami', 'MLS')).toBe('Miami')
    expect(toFitScoreClubName('Sporting KC', 'MLS')).toBe('Kansas City')
    expect(toFitScoreClubName('Real Salt Lake', 'MLS')).toBe('Salt Lake')
    expect(toFitScoreClubName('Inter', 'Serie A')).toBe('Inter')
    expect(toFitScoreClubName('Sporting CP', 'Liga Portugal')).toBe('Sporting CP')
  })
})
