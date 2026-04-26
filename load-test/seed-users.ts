const BASE_URL = process.argv.includes('--base-url')
  ? process.argv[process.argv.indexOf('--base-url') + 1]
  : 'http://localhost:3333'

const TOTAL_USERS = 200
const PASSWORD = 'loadtest123'

async function createUser(index: number): Promise<boolean> {
  const email = `loadtest+${index}@careerhub.test`

  const res = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': BASE_URL },
    body: JSON.stringify({ name: `LoadTest User ${index}`, email, password: PASSWORD }),
  })

  const text = await res.text()
  let body: any = {}
  try { body = JSON.parse(text) } catch { body = { raw: text } }

  if (res.ok) {
    console.log(`✓ Criado: ${email}`)
    return true
  }

  if (res.status === 409 || body?.error?.includes('already') || body?.code === 'USER_ALREADY_EXISTS') {
    console.log(`~ Já existe: ${email}`)
    return true
  }

  console.error(`✗ Erro ao criar ${email}: ${res.status} — ${JSON.stringify(body)}`)
  return false
}

async function verifyLogin(index: number): Promise<boolean> {
  const email = `loadtest+${index}@careerhub.test`

  const res = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': BASE_URL },
    body: JSON.stringify({ email, password: PASSWORD }),
  })

  if (res.ok) {
    try {
      const { token } = await res.json()
      if (token) return true
    } catch { /* resposta inválida */ }
  }

  console.error(`✗ Login falhou para ${email}: ${res.status}`)
  return false
}

async function runInBatches<T>(tasks: (() => Promise<T>)[], batchSize: number): Promise<T[]> {
  const results: T[] = []
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize)
    results.push(...await Promise.all(batch.map(t => t())))
  }
  return results
}

async function main() {
  console.log(`\nSeed de usuários de teste — ${BASE_URL}\n`)

  const createResults = await runInBatches(
    Array.from({ length: TOTAL_USERS }, (_, i) => () => createUser(i + 1)),
    10
  )
  console.log(`\n${createResults.filter(Boolean).length}/${TOTAL_USERS} usuários prontos`)

  console.log('\nVerificando logins...')
  const loginResults = await runInBatches(
    Array.from({ length: TOTAL_USERS }, (_, i) => () => verifyLogin(i + 1)),
    10
  )
  const loggedIn = loginResults.filter(Boolean).length
  console.log(`${loggedIn}/${TOTAL_USERS} logins OK`)

  if (loggedIn < TOTAL_USERS) {
    console.error('\nAlguns usuários não conseguiram logar. Verifique os erros acima.')
    process.exit(1)
  }

  console.log('\nTudo pronto! Rode o teste de carga com:')
  console.log('  k6 run load-test/k6.js')
  console.log('  k6 run --vus 50 --duration 60s load-test/k6.js')
}

main()
