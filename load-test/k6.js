/**
 * Teste de carga completo — Career Hub API
 *
 * Fluxo por usuário virtual (simula uma sessão completa de carreira):
 *   1.  Login
 *   2.  Listar saves + clubes + competições
 *   3.  Criar save (Liverpool)
 *   4.  Buscar team stats da temporada atual
 *   5.  Atualizar team stats (liga)
 *   6.  Criar 5 jogadores
 *   7.  Listar jogadores ativos
 *   8.  Atualizar dados de um jogador (PUT)
 *   9.  Atualizar stats de 3 jogadores (PATCH /stats)
 *  10.  Registrar transferência de compra
 *  11.  Registrar transferência de venda
 *  12.  Listar transferências da temporada
 *  13.  Avançar temporada (2025/26 → 2026/27)
 *  14.  Listar jogadores na nova temporada
 *  15.  Atualizar team stats na nova temporada
 *  16.  Adicionar troféu da liga
 *  17.  Listar troféus
 *  18.  Mudar de clube (Arsenal)
 *  19.  Listar club stints
 *  20.  Criar jogador no novo clube
 *  21.  Buscar jogador por ID
 *  22.  Deletar save (limpeza)
 *
 * Como rodar:
 *   k6 run load-test/k6.js
 *   k6 run --vus 50 --duration 60s load-test/k6.js
 *
 * Variáveis de ambiente (opcionais):
 *   BASE_URL  — padrão: http://localhost:3333
 *   VUS       — virtual users (padrão: 10)
 *   DURATION  — duração (padrão: 30s)
 */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'

// --- Métricas customizadas ---
const loginDuration         = new Trend('login_duration', true)
const listSavesDuration     = new Trend('list_saves_duration', true)
const createSaveDuration    = new Trend('create_save_duration', true)
const listPlayersDuration   = new Trend('list_players_duration', true)
const createPlayerDuration  = new Trend('create_player_duration', true)
const updatePlayerDuration  = new Trend('update_player_duration', true)
const updateStatsDuration   = new Trend('update_player_stats_duration', true)
const transferDuration      = new Trend('transfer_duration', true)
const advanceSeasonDuration = new Trend('advance_season_duration', true)
const changeClubDuration    = new Trend('change_club_duration', true)
const teamStatsDuration     = new Trend('team_stats_duration', true)
const trophyDuration        = new Trend('trophy_duration', true)

const loginErrors        = new Rate('login_errors')
const createSaveErrors   = new Rate('create_save_errors')
const createPlayerErrors = new Rate('create_player_errors')
const transferErrors     = new Rate('transfer_errors')
const advanceSeasonErrors = new Rate('advance_season_errors')
const changeClubErrors   = new Rate('change_club_errors')

// --- Configuração ---
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3333'

export const options = {
  stages: [
    { duration: '10s', target: Number(__ENV.VUS) || 10 },
    { duration: __ENV.DURATION || '30s', target: Number(__ENV.VUS) || 10 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_failed:              ['rate<0.05'],
    http_req_duration:            ['p(95)<3000'],
    login_duration:               ['p(95)<3000'],
    list_saves_duration:          ['p(95)<1500'],
    create_save_duration:         ['p(95)<1000'],
    list_players_duration:        ['p(95)<2500'],
    create_player_duration:       ['p(95)<500'],
    update_player_duration:       ['p(95)<500'],
    update_player_stats_duration: ['p(95)<500'],
    transfer_duration:            ['p(95)<1000'],
    advance_season_duration:      ['p(95)<2000'],
    change_club_duration:         ['p(95)<2000'],
    team_stats_duration:          ['p(95)<1500'],
    trophy_duration:              ['p(95)<500'],
  },
}

// Pool de 200 usuários de teste — crie com load-test/seed-users.ts
const TEST_USERS = Array.from({ length: 200 }, (_, i) => ({
  email: `loadtest+${i + 1}@careerhub.test`,
  password: 'loadtest123',
}))

const HEADERS_JSON = { 'Content-Type': 'application/json', 'Origin': BASE_URL }

const POSITIONS = ['GOL', 'ZAG', 'LD', 'LE', 'VOL', 'MC', 'MEI', 'PE', 'PD', 'SA', 'ATA']
const STATUSES  = ['Crucial', 'Important', 'Role', 'Sporadic', 'Promising']

// --- Helpers HTTP ---
function post(path, body, token) {
  const headers = { ...HEADERS_JSON }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return http.post(`${BASE_URL}${path}`, JSON.stringify(body), { headers })
}

function get(path, token) {
  const headers = { 'Origin': BASE_URL }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return http.get(`${BASE_URL}${path}`, { headers })
}

function patch(path, body, token) {
  const headers = { ...HEADERS_JSON }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return http.patch(`${BASE_URL}${path}`, JSON.stringify(body), { headers })
}

function put(path, body, token) {
  const headers = { ...HEADERS_JSON }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return http.put(`${BASE_URL}${path}`, JSON.stringify(body), { headers })
}

function del(path, token) {
  const headers = { 'Origin': BASE_URL }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return http.del(`${BASE_URL}${path}`, null, { headers })
}

function parse(res) {
  try { return JSON.parse(res.body) } catch { return null }
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

// --- Setup: busca IDs de competições uma única vez antes do teste ---
export function setup() {
  const loginRes = http.post(
    `${BASE_URL}/api/auth/sign-in/email`,
    JSON.stringify({ email: 'loadtest+1@careerhub.test', password: 'loadtest123' }),
    { headers: HEADERS_JSON }
  )
  const token = parse(loginRes)?.token
  if (!token) {
    console.error('Setup: login falhou — verifique se os usuários foram criados com seed-users.ts')
    return { englishLeagueId: null, englishCupId: null }
  }

  const comps = parse(http.get(`${BASE_URL}/api/competitions`, {
    headers: { 'Origin': BASE_URL, 'Authorization': `Bearer ${token}` },
  })) || []

  return {
    englishLeagueId: comps.find(c => c.country === 'England' && c.type === 'League')?.id || null,
    englishCupId:    comps.find(c => c.country === 'England' && c.type === 'NationalCup')?.id || null,
  }
}

// --- Cenário principal ---
export default function (data) {
  const user = TEST_USERS[Math.floor(Math.random() * TEST_USERS.length)]

  // ─── 1. Login ───────────────────────────────────────────────────────────────
  const loginRes = post('/api/auth/sign-in/email', {
    email: user.email, password: user.password,
  })
  loginDuration.add(loginRes.timings.duration)
  const loginOk = check(loginRes, {
    'login: status 200':  r => r.status === 200,
    'login: tem token':   r => !!parse(r)?.token,
  })
  loginErrors.add(!loginOk)
  if (!loginOk) return
  const token = parse(loginRes).token
  sleep(0.3)

  // ─── 2. Leituras iniciais ────────────────────────────────────────────────────
  const listSavesRes = get('/api/saves', token)
  listSavesDuration.add(listSavesRes.timings.duration)
  check(listSavesRes, {
    'list saves: status 200': r => r.status === 200,
    'list saves: é array':    r => Array.isArray(parse(r)),
  })

  get('/api/clubs', token)
  get('/api/competitions', token)
  sleep(0.3)

  // ─── 3. Criar save ───────────────────────────────────────────────────────────
  const createSaveRes = post('/api/saves', {
    name:   `LoadTest-${__VU}-${Date.now()}`,
    club:   'Liverpool',
    budget: rand(80, 150),
  }, token)
  createSaveDuration.add(createSaveRes.timings.duration)
  const createSaveOk = check(createSaveRes, {
    'create save: status 201': r => r.status === 201,
    'create save: tem id':     r => !!parse(r)?.id,
  })
  createSaveErrors.add(!createSaveOk)
  if (!createSaveOk) return
  const saveId = parse(createSaveRes).id
  sleep(0.2)

  // ─── 4. Team stats da temporada atual ────────────────────────────────────────
  const teamStatsRes = get(`/api/saves/${saveId}/team-stats?season=current`, token)
  teamStatsDuration.add(teamStatsRes.timings.duration)
  check(teamStatsRes, { 'team stats: status 200': r => r.status === 200 })
  const teamStats = parse(teamStatsRes)
  const leagueStat = Array.isArray(teamStats)
    ? teamStats.find(s => s.competition?.type === 'League')
    : null
  sleep(0.2)

  // ─── 5. Atualizar team stats (liga) ──────────────────────────────────────────
  if (leagueStat?.id) {
    const res = patch(`/api/saves/${saveId}/team-stats/${leagueStat.id}`, {
      wins:          rand(5, 18),
      draws:         rand(2, 8),
      losses:        rand(1, 6),
      goalsPro:      rand(25, 55),
      goalsAgainst:  rand(10, 30),
      leaguePosition: rand(1, 8),
    }, token)
    check(res, { 'update team stats: status 200': r => r.status === 200 })
    sleep(0.1)
  }

  // ─── 6. Criar 5 jogadores ────────────────────────────────────────────────────
  const players = [
    { position: 'GOL', ovr: rand(78, 88), status: 'Crucial',   age: rand(22, 32), salary: rand(20, 50),  marketValue: rand(10, 25) },
    { position: 'ATA', ovr: rand(82, 92), status: 'Important', age: rand(21, 28), salary: rand(50, 120), marketValue: rand(30, 80) },
    { position: 'MC',  ovr: rand(76, 86), status: 'Role',      age: rand(24, 30), salary: rand(25, 60),  marketValue: rand(12, 35) },
    { position: 'PE',  ovr: rand(80, 90), status: 'Promising', age: rand(19, 23), salary: rand(20, 70),  marketValue: rand(20, 60), potential: rand(88, 95) },
    { position: 'ZAG', ovr: rand(77, 87), status: 'Important', age: rand(25, 31), salary: rand(30, 70),  marketValue: rand(15, 40) },
  ]

  const playerIds = []
  for (let i = 0; i < players.length; i++) {
    const res = post(`/api/saves/${saveId}/players`, {
      name: `P${i}-VU${__VU}-${Date.now()}`,
      ...players[i],
    }, token)
    createPlayerDuration.add(res.timings.duration)
    const ok = check(res, { 'create player: status 201': r => r.status === 201 })
    createPlayerErrors.add(!ok)
    const p = parse(res)
    if (ok && p?.id) playerIds.push(p.id)
    sleep(0.1)
  }
  sleep(0.2)

  // ─── 7. Listar jogadores ativos ──────────────────────────────────────────────
  const listActiveRes = get(`/api/saves/${saveId}/players?active=true`, token)
  listPlayersDuration.add(listActiveRes.timings.duration)
  check(listActiveRes, {
    'list active players: status 200':  r => r.status === 200,
    'list active players: é array':     r => Array.isArray(parse(r)),
  })

  // Listar todos (sem filtro)
  const listAllRes = get(`/api/saves/${saveId}/players`, token)
  check(listAllRes, { 'list all players: status 200': r => r.status === 200 })
  sleep(0.2)

  // ─── 8. Atualizar dados de um jogador (PUT) ──────────────────────────────────
  if (playerIds.length > 0) {
    const res = put(`/api/saves/${saveId}/players/${playerIds[0]}`, {
      ovr:         rand(83, 93),
      age:         rand(24, 28),
      status:      pick(STATUSES),
      marketValue: rand(25, 70),
      salary:      rand(40, 100),
      shirtNumber: rand(1, 99),
    }, token)
    updatePlayerDuration.add(res.timings.duration)
    check(res, { 'update player (PUT): status 200': r => r.status === 200 })
    sleep(0.1)
  }

  // ─── 9. Atualizar stats de 3 jogadores (PATCH /stats) ───────────────────────
  for (const pid of playerIds.slice(0, 3)) {
    const res = patch(`/api/saves/${saveId}/players/${pid}/stats`, {
      goals:       rand(0, 20),
      assists:     rand(0, 15),
      matches:     rand(15, 38),
      yellowCards: rand(0, 8),
      redCards:    rand(0, 1),
      cleanSheets: rand(0, 12),
    }, token)
    updateStatsDuration.add(res.timings.duration)
    check(res, { 'update player stats: status 200': r => r.status === 200 })
    sleep(0.1)
  }

  // ─── 10. Transferência de compra ─────────────────────────────────────────────
  const buyRes = post(`/api/saves/${saveId}/transfers`, {
    playerName: `Buy-${__VU}-${Date.now()}`,
    type:       'compra',
    from:       'Manchester City',
    to:         'Liverpool',
    fee:        rand(15, 90),
    season:     '2025/26',
  }, token)
  transferDuration.add(buyRes.timings.duration)
  const buyOk = check(buyRes, { 'transfer compra: status 201': r => r.status === 201 })
  transferErrors.add(!buyOk)
  const boughtPlayerId = parse(buyRes)?.player?.id || null
  sleep(0.2)

  // ─── 11. Transferência de venda ──────────────────────────────────────────────
  const sellTargetId = boughtPlayerId || (playerIds.length > 2 ? playerIds[2] : null)
  if (sellTargetId) {
    const sellRes = post(`/api/saves/${saveId}/transfers`, {
      playerName: `Sell-${__VU}-${Date.now()}`,
      type:       'venda',
      from:       'Liverpool',
      to:         pick(['Arsenal', 'Chelsea', 'Tottenham Hotspur']),
      fee:        rand(5, 50),
      season:     '2025/26',
      playerId:   sellTargetId,
    }, token)
    transferDuration.add(sellRes.timings.duration)
    check(sellRes, { 'transfer venda: status 201': r => r.status === 201 })
    sleep(0.1)
  }

  // ─── 12. Listar transferências ───────────────────────────────────────────────
  const listTransfersRes = get(`/api/saves/${saveId}/transfers?season=current`, token)
  check(listTransfersRes, { 'list transfers: status 200': r => r.status === 200 })
  sleep(0.2)

  // ─── 13. Avançar temporada (2025/26 → 2026/27) ──────────────────────────────
  const advanceRes = patch(`/api/saves/${saveId}`, {
    currentYear:   2026,
    currentSeason: '2026/27',
  }, token)
  advanceSeasonDuration.add(advanceRes.timings.duration)
  const advanceOk = check(advanceRes, {
    'advance season: status 200':    r => r.status === 200,
    'advance season: nova temporada': r => parse(r)?.currentSeason === '2026/27',
  })
  advanceSeasonErrors.add(!advanceOk)
  sleep(0.3)

  // ─── 14. Listar jogadores na nova temporada ──────────────────────────────────
  const listNewSeasonRes = get(`/api/saves/${saveId}/players?active=true`, token)
  listPlayersDuration.add(listNewSeasonRes.timings.duration)
  check(listNewSeasonRes, { 'list players new season: status 200': r => r.status === 200 })
  sleep(0.2)

  // ─── 15. Team stats nova temporada ───────────────────────────────────────────
  const newTeamStatsRes = get(`/api/saves/${saveId}/team-stats?season=current`, token)
  teamStatsDuration.add(newTeamStatsRes.timings.duration)
  check(newTeamStatsRes, { 'team stats new season: status 200': r => r.status === 200 })
  const newTeamStats = parse(newTeamStatsRes)
  const newLeagueStat = Array.isArray(newTeamStats)
    ? newTeamStats.find(s => s.competition?.type === 'League')
    : null

  if (newLeagueStat?.id) {
    const res = patch(`/api/saves/${saveId}/team-stats/${newLeagueStat.id}`, {
      wins:   rand(3, 10),
      draws:  rand(1, 5),
      losses: rand(0, 3),
    }, token)
    check(res, { 'update team stats new season: status 200': r => r.status === 200 })
  }
  sleep(0.2)

  // ─── 16. Adicionar troféu ────────────────────────────────────────────────────
  if (data.englishLeagueId) {
    const trophyRes = post(`/api/saves/${saveId}/trophies`, {
      competitionId: data.englishLeagueId,
      year:          2026,
    }, token)
    trophyDuration.add(trophyRes.timings.duration)
    check(trophyRes, { 'create trophy: status 201': r => r.status === 201 })
    sleep(0.1)
  }

  // ─── 17. Listar troféus ──────────────────────────────────────────────────────
  const listTrophiesRes = get(`/api/saves/${saveId}/trophies`, token)
  check(listTrophiesRes, { 'list trophies: status 200': r => r.status === 200 })
  sleep(0.1)

  // ─── 18. Mudar de clube (Arsenal) ────────────────────────────────────────────
  const changeClubRes = post(`/api/saves/${saveId}/club-stints`, {
    club: 'Arsenal',
  }, token)
  changeClubDuration.add(changeClubRes.timings.duration)
  const changeClubOk = check(changeClubRes, {
    'change club: status 201':    r => r.status === 201,
    'change club: novo clube':    r => parse(r)?.club === 'Arsenal',
  })
  changeClubErrors.add(!changeClubOk)
  sleep(0.2)

  // ─── 19. Listar club stints ──────────────────────────────────────────────────
  const listStintsRes = get(`/api/saves/${saveId}/club-stints`, token)
  check(listStintsRes, {
    'list stints: status 200':   r => r.status === 200,
    'list stints: 2 passagens':  r => (parse(r) || []).length === 2,
  })
  sleep(0.1)

  // ─── 20. Criar jogador no novo clube ────────────────────────────────────────
  const newPlayerRes = post(`/api/saves/${saveId}/players`, {
    name:        `Arsenal-${__VU}-${Date.now()}`,
    position:    pick(POSITIONS),
    age:         rand(19, 30),
    status:      pick(STATUSES),
    ovr:         rand(74, 88),
    salary:      rand(20, 80),
    marketValue: rand(10, 50),
  }, token)
  createPlayerDuration.add(newPlayerRes.timings.duration)
  const newPlayerOk = check(newPlayerRes, { 'create player new club: status 201': r => r.status === 201 })
  createPlayerErrors.add(!newPlayerOk)
  const newPlayerId = parse(newPlayerRes)?.id || null
  sleep(0.1)

  // ─── 21. Buscar jogador por ID ───────────────────────────────────────────────
  const lookupId = newPlayerId || (playerIds.length > 0 ? playerIds[0] : null)
  if (lookupId) {
    const getPlayerRes = get(`/api/saves/${saveId}/players/${lookupId}`, token)
    check(getPlayerRes, { 'get player by id: status 200': r => r.status === 200 })
    sleep(0.1)
  }

  // ─── 22. Limpeza ─────────────────────────────────────────────────────────────
  const deleteRes = del(`/api/saves/${saveId}`, token)
  check(deleteRes, { 'delete save: status 200 ou 204': r => r.status === 200 || r.status === 204 })
  sleep(0.5)
}
