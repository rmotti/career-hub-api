import { describe, expect, it } from 'vitest'
import {
  defaultTrustedOrigins,
  getTrustedOrigins,
  isCredentialedOriginAllowed,
  isTrustedOrigin,
} from '../origins.js'

describe('trusted origins', () => {
  it('trusts the production frontend domain', () => {
    expect(isTrustedOrigin('https://fc-career-hub.vercel.app', defaultTrustedOrigins)).toBe(true)
  })

  it('does not trust arbitrary Vercel deployments (no broad wildcards)', () => {
    // Um atacante poderia criar estes projetos na Vercel; não podem ser confiáveis.
    expect(isTrustedOrigin('https://fc-career-evil.vercel.app', defaultTrustedOrigins)).toBe(false)
    expect(
      isTrustedOrigin(
        'https://fc-career-31neefzi4-rodrigo-mottis-projects.vercel.app',
        defaultTrustedOrigins,
      ),
    ).toBe(false)
  })

  it('does not trust unrelated origins', () => {
    expect(isTrustedOrigin('https://example.com', defaultTrustedOrigins)).toBe(false)
  })

  it('allows pinning an exact preview origin via TRUSTED_ORIGINS', () => {
    process.env.TRUSTED_ORIGINS = 'https://fc-career-hub-staging.vercel.app'

    expect(isTrustedOrigin('https://fc-career-hub-staging.vercel.app', getTrustedOrigins())).toBe(true)
    expect(isTrustedOrigin('https://fc-career-other.vercel.app', getTrustedOrigins())).toBe(false)

    delete process.env.TRUSTED_ORIGINS
  })

  it('trims and deduplicates configured origins', () => {
    process.env.TRUSTED_ORIGINS = ' https://custom.example.com ,https://custom.example.com '

    expect(getTrustedOrigins().filter((origin) => origin === 'https://custom.example.com')).toHaveLength(1)

    delete process.env.TRUSTED_ORIGINS
  })
})

describe('isCredentialedOriginAllowed (cookie + credentials flow)', () => {
  it('allows the exact production frontend origin', () => {
    expect(isCredentialedOriginAllowed('https://fc-career-hub.vercel.app', defaultTrustedOrigins)).toBe(true)
  })

  it('allows requests with no Origin header (same-origin / non-browser)', () => {
    expect(isCredentialedOriginAllowed(undefined, defaultTrustedOrigins)).toBe(true)
  })

  it('NEVER honors wildcard matches in the credentialed flow', () => {
    // Mesmo configurado com wildcard, o fluxo credenciado só aceita origins exatos.
    const withWildcard = ['https://fc-career-*.vercel.app', 'https://fc-career-hub.vercel.app']
    expect(isCredentialedOriginAllowed('https://fc-career-evil.vercel.app', withWildcard)).toBe(false)
    expect(isCredentialedOriginAllowed('https://fc-career-hub.vercel.app', withWildcard)).toBe(true)
  })

  it('rejects unrelated origins', () => {
    expect(isCredentialedOriginAllowed('https://example.com', defaultTrustedOrigins)).toBe(false)
  })
})
