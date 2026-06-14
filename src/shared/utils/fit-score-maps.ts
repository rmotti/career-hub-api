import { MANUAL_CLUB_NAME_BY_LEAGUE_MAP } from './fit-score-club-aliases.generated.js'

// Translates Fc26Player.league (dataset names) to fit-score-svc league codes
export const LEAGUE_CODE: Record<string, string> = {
  'Premier League':             'GB1',
  'La Liga':                    'ES1',
  'Bundesliga':                 'L1',
  'Serie A':                    'IT1',
  'Ligue 1':                    'FR1',
  'Primeira Liga':              'PO1',
  'Eredivisie':                 'NL1',
  'Pro League':                 'BE1',  // Belgian First Division A
  'Ekstraklasa':                'PL1',
  'Süper Lig':                  'TR1',
  'Super League':               'GR1',  // Greek Super League
  'Superliga':                  'DK1',  // Danish Superliga
  'Allsvenskan':                'SE1',
  'Eliteserien':                'NO1',
  'Major League Soccer':        'MLS1',
  'K League 1':                 'KR1',
  'A-League Men':               'AUS1',
  'Liga Profesional de Fútbol': 'ARG1',
  'Categoría Primera A':        'COL1',
  'Série A':                    'BRA1', // Brasileirão
  'Premiership':                'SC1',  // Scottish Premiership
  'První liga':                 'C1',   // Czech First League
  'Liga I':                     'RO1',  // Romanian Liga I
  // Disambiguated names emitted by the FC26 ETL (collided league_name → real country).
  // The model supports these origin leagues; without these entries they fell back to "unknown".
  'Austrian Bundesliga':        'A1',   // Bundesliga collided with Germany
  'Ukrainian Premier League':   'UKR1', // Premier League collided with England
  'Saudi Pro League':           'SA1',  // Pro League collided with Belgium
}

// Translates Fc26Player.nation (dataset names) to fit-score-svc nationality strings.
// Only entries that differ from the dataset value are listed — everything else is passed as-is.
export const NATIONALITY_MAP: Record<string, string> = {
  'Korea Republic':        'Korea, South',
  'Bosnia and Herzegovina':'Bosnia-Herzegovina',
  "Côte d'Ivoire":         "Cote d'Ivoire",
  'Congo DR':              'DR Congo',
  'Czechia':               'Czech Republic',
  'Republic of Ireland':   'Ireland',
  'Gambia':                'The Gambia',
  'Cabo Verde':            'Cape Verde',
}

// Translates app/FC26 club names to the fit-score-svc club vocabulary.
export const CLUB_NAME_MAP: Record<string, string> = {
  'FC Barcelona':        'Barcelona',
  'Manchester City':     'Man City',
  'Manchester United':   'Man Utd',
  'Paris Saint-Germain': 'PSG',
  'Atlético de Madrid':  'Atlético Madrid',
}

export const CLUB_NAME_BY_LEAGUE_MAP: Record<string, Record<string, string>> = {
  MLS: {
    'Inter Miami':     'Miami',
    'Real Salt Lake':  'Salt Lake',
    'Sporting KC':     'Kansas City',
  },
}

export function toLeagueCode(league: string | null | undefined): string | null {
  if (!league) return null
  return LEAGUE_CODE[league] ?? null
}

export function toNationality(nation: string | null | undefined): string | null {
  if (!nation) return null
  return NATIONALITY_MAP[nation] ?? nation
}

export function toFitScoreClubName(club: string, league?: string | null): string {
  if (league) {
    const leagueAliases = {
      ...(CLUB_NAME_BY_LEAGUE_MAP[league] ?? {}),
      ...(MANUAL_CLUB_NAME_BY_LEAGUE_MAP[league] ?? {}),
    }

    if (leagueAliases[club]) return leagueAliases[club]
  }

  return CLUB_NAME_MAP[club] ?? club
}
