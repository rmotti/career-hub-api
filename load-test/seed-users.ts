const args = process.argv

const BASE_URL = args.includes('--base-url')
  ? args[args.indexOf('--base-url') + 1]
  : 'http://localhost:3333'

const START = args.includes('--start')
  ? parseInt(args[args.indexOf('--start') + 1], 10)
  : 1

const COUNT = args.includes('--count')
  ? parseInt(args[args.indexOf('--count') + 1], 10)
  : 200

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

  if (res.status === 409 || body?.code?.includes('USER_ALREADY_EXISTS') || body?.error?.includes('already')) {
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
  const end = START + COUNT - 1
  console.log(`\nSeed de usuários de teste — ${BASE_URL}`)
  console.log(`Criando usuários ${START} a ${end} (${COUNT} usuários)\n`)

  const indices = Array.from({ length: COUNT }, (_, i) => START + i)

  const createResults = await runInBatches(
    indices.map(i => () => createUser(i)),
    10
  )
  console.log(`\n${createResults.filter(Boolean).length}/${COUNT} usuários prontos`)

  console.log('\nVerificando logins...')
  const loginResults = await runInBatches(
    indices.map(i => () => verifyLogin(i)),
    10
  )
  const loggedIn = loginResults.filter(Boolean).length
  console.log(`${loggedIn}/${COUNT} logins OK`)

  if (loggedIn < COUNT) {
    console.error('\nAlguns usuários não conseguiram logar. Verifique os erros acima.')
    process.exit(1)
  }

  console.log('\nTudo pronto! Rode o teste de carga com:')
  console.log('  k6 run load-test/k6.js')
  console.log(`  k6 run -e VUS=${end} -e DURATION=60s load-test/k6.js`)
}

main()
