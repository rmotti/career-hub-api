// Only EXACT origins we control. No wildcards on `*.vercel.app`:
// anyone can create a Vercel project whose hostname would match the pattern,
// becoming a trusted, credentialed origin (origin IDOR). Legitimate previews
// must be pinned via the `TRUSTED_ORIGINS` env.
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
 * Matcher for CORS WITH credentials (httpOnly cookie + `credentials: true`). Wildcards are
 * forbidden here: a pattern like `https://fc-*.vercel.app` would let any matching Vercel project
 * receive credentialed responses and read/write the session cookie. We require an EXACT
 * origin. Legitimate previews must be pinned as exact origins in `TRUSTED_ORIGINS`.
 * A missing `origin` (same-origin / non-browser client) is allowed — the browser simply
 * doesn't receive `Access-Control-Allow-Origin` in that case.
 */
export function isCredentialedOriginAllowed(origin: string | undefined, trustedOrigins = getTrustedOrigins()) {
  if (!origin) return true
  return trustedOrigins.some((trustedOrigin) => !trustedOrigin.includes('*') && trustedOrigin === origin)
}
