/**
 * Teste de carga — Career Hub API
 *
 * Fluxo por usuário virtual:
 *   1. Login com uma conta de teste pré-criada
 *   2. Listar saves
 *   3. Criar um save
 *   4. Listar jogadores do save
 *   5. Criar um jogador
 *   6. Listar clubes
 *   7. Deletar o save criado (limpeza)
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
const loginErrors = new Rate('login_errors')
const listSavesErrors = new Rate('list_saves_errors')
const createSaveErrors = new Rate('create_save_errors')
const listPlayersErrors = new Rate('list_players_errors')

const loginDuration = new Trend('login_duration', true)
const listSavesDuration = new Trend('list_saves_duration', true)
const createSaveDuration = new Trend('create_save_duration', true)
const listPlayersDuration = new Trend('list_players_duration', true)

// --- Configuração ---
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3333'

export const options = {
  stages: [
    { duration: '10s', target: Number(__ENV.VUS) || 10 },  // rampa de subida
    { duration: __ENV.DURATION || '30s', target: Number(__ENV.VUS) || 10 },  // carga sustentada
    { duration: '10s', target: 0 },  // rampa de descida
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],          // menos de 5% de erro
    http_req_duration: ['p(95)<2000'],       // 95% das requests < 2s
    login_duration: ['p(95)<3000'],
    list_saves_duration: ['p(95)<1000'],
    create_save_duration: ['p(95)<1500'],
    list_players_duration: ['p(95)<1500'],
  },
}

// Pool de usuários de teste — crie com load-test/seed-users.js antes de rodar
const TEST_USERS = Array.from({ length: 20 }, (_, i) => ({
  email: `loadtest+${i + 1}@careerhub.test`,
  password: 'loadtest123',
}))

const HEADERS_JSON = { 'Content-Type': 'application/json', 'Origin': BASE_URL }

// --- Helpers ---
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

function del(path, token) {
  const headers = { 'Origin': BASE_URL }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return http.del(`${BASE_URL}${path}`, null, { headers })
}

// --- Cenário principal ---
export default function () {
  // Escolhe um usuário aleatório do pool
  const user = TEST_USERS[Math.floor(Math.random() * TEST_USERS.length)]

  // 1. Login
  const loginRes = post('/api/auth/sign-in/email', {
    email: user.email,
    password: user.password,
  })

  loginDuration.add(loginRes.timings.duration)
  const loginOk = check(loginRes, {
    'login: status 200': (r) => r.status === 200,
    'login: tem token': (r) => {
      try { return !!JSON.parse(r.body).token } catch { return false }
    },
  })

  loginErrors.add(!loginOk)

  if (!loginOk) {
    console.error(`Login falhou para ${user.email}: ${loginRes.status} — ${loginRes.body}`)
    return
  }

  const token = JSON.parse(loginRes.body).token
  sleep(0.5)

  // 2. Listar saves
  const listSavesRes = get('/api/saves', token)
  listSavesDuration.add(listSavesRes.timings.duration)
  const listSavesOk = check(listSavesRes, {
    'list saves: status 200': (r) => r.status === 200,
    'list saves: é array': (r) => {
      try { return Array.isArray(JSON.parse(r.body)) } catch { return false }
    },
  })
  listSavesErrors.add(!listSavesOk)
  sleep(0.3)

  // 3. Listar clubes (endpoint público, sem dados pesados)
  const listClubsRes = get('/api/clubs', token)
  check(listClubsRes, {
    'list clubs: status 200': (r) => r.status === 200,
  })
  sleep(0.2)

  // 4. Criar um save
  const saveName = `LoadTest-${__VU}-${Date.now()}`
  const createSaveRes = post('/api/saves', {
    name: saveName,
    club: 'Liverpool',
    budget: 100,
  }, token)

  createSaveDuration.add(createSaveRes.timings.duration)
  const createSaveOk = check(createSaveRes, {
    'create save: status 201': (r) => r.status === 201,
    'create save: tem id': (r) => {
      try { return !!JSON.parse(r.body).id } catch { return false }
    },
  })
  createSaveErrors.add(!createSaveOk)

  if (!createSaveOk) {
    console.error(`Create save falhou: ${createSaveRes.status} — ${createSaveRes.body}`)
    return
  }

  const saveId = JSON.parse(createSaveRes.body).id
  sleep(0.5)

  // 5. Listar jogadores do save
  const listPlayersRes = get(`/api/saves/${saveId}/players`, token)
  listPlayersDuration.add(listPlayersRes.timings.duration)
  check(listPlayersRes, {
    'list players: status 200': (r) => r.status === 200,
  })
  listPlayersErrors.add(listPlayersRes.status !== 200)
  sleep(0.3)

  // 6. Limpeza — deletar o save criado
  const deleteRes = del(`/api/saves/${saveId}`, token)
  check(deleteRes, {
    'delete save: status 200 ou 204': (r) => r.status === 200 || r.status === 204,
  })

  sleep(1)
}
