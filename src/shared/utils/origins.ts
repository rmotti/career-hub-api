export const defaultTrustedOrigins = [
  'https://fc-26-career-hub.vercel.app',
  'https://fc-career-hub.vercel.app',
  'https://fc-26-career-hub-*.vercel.app',
  'https://fc-career-*.vercel.app',
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
