export const CLUBS = [
  // Premier League
  'Arsenal',
  'Aston Villa',
  'Chelsea',
  'Everton',
  'Fulham',
  'Liverpool',
  'Manchester City',
  'Manchester United',
  'Newcastle United',
  'Nottingham Forest',
  'Tottenham Hotspur',
  'West Ham United',
  // La Liga
  'Atletico de Madrid',
  'Barcelona',
  'Real Madrid',
  'Sevilla',
  'Valencia',
  'Villarreal',
  // Serie A
  'AC Milan',
  'AS Roma',
  'Inter Milan',
  'Juventus',
  'Napoli',
  'Lazio',
  // Bundesliga
  'Bayer Leverkusen',
  'Borussia Dortmund',
  'Bayern Munich',
  'RB Leipzig',
  // Ligue 1
  'Monaco',
  'Paris Saint-Germain',
  // Brasileirão
  'Flamengo',
  'Palmeiras',
  'São Paulo',
  'Corinthians',
  'Santos',
  'Grêmio',
]

export function getAllClubs(): string[] {
  return CLUBS
}

export function clubExists(club: string): boolean {
  return CLUBS.includes(club)
}
