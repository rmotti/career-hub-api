// Apenas origens EXATAS que controlamos. Nada de wildcards em `*.vercel.app`:
// qualquer um pode criar um projeto Vercel cujo hostname casaria com o padrão,
// virando uma origem confiável e credenciada (IDOR de origem). Previews legítimos
// devem ser fixados via a env `TRUSTED_ORIGINS`.
export const defaultTrustedOrigins = [
  'https://fc-career-hub.vercel.app',
]

export function getTrustedOrigins() {
  const configuredOrigins = process.env.TRUSTED_ORIGINS
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean) ?? []

  return [...new Set([...configuredOrigins, ...defaultTrustedOrigins])]
}

function wildcardToRegExp(pattern: string) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`)
}

export function isTrustedOrigin(origin: string | undefined, trustedOrigins = getTrustedOrigins()) {
  if (!origin) return true

  return trustedOrigins.some((trustedOrigin) => {
    if (trustedOrigin === origin) return true
    if (!trustedOrigin.includes('*')) return false

    return wildcardToRegExp(trustedOrigin).test(origin)
  })
}

/**
 * Matcher para o CORS COM credenciais (cookie httpOnly + `credentials: true`). Aqui wildcard
 * é proibido: um padrão como `https://fc-*.vercel.app` deixaria qualquer projeto Vercel que
 * casasse receber respostas credenciadas e ler/escrever o cookie de sessão. Exigimos origin
 * EXATO. Previews legítimos devem ser fixados como origins exatos em `TRUSTED_ORIGINS`.
 * `origin` ausente (same-origin / cliente não-browser) é permitido — o browser simplesmente
 * não recebe `Access-Control-Allow-Origin` nesse caso.
 */
export function isCredentialedOriginAllowed(origin: string | undefined, trustedOrigins = getTrustedOrigins()) {
  if (!origin) return true
  return trustedOrigins.some((trustedOrigin) => !trustedOrigin.includes('*') && trustedOrigin === origin)
}
