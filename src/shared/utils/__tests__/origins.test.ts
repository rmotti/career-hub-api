import { describe, expect, it } from 'vitest'
import { defaultTrustedOrigins, getTrustedOrigins, isTrustedOrigin } from '../origins.js'

describe('trusted origins', () => {
  it('trusts the production frontend domain', () => {
    expect(isTrustedOrigin('https://fc-career-hub.vercel.app', defaultTrustedOrigins)).toBe(true)
  })

  it('trusts Vercel preview deployments for the frontend project', () => {
    expect(
      isTrustedOrigin(
        'https://fc-career-31neefzi4-rodrigo-mottis-projects.vercel.app',
        defaultTrustedOrigins,
      ),
    ).toBe(true)
  })

  it('does not trust unrelated origins', () => {
    expect(isTrustedOrigin('https://example.com', defaultTrustedOrigins)).toBe(false)
  })

  it('trims and deduplicates configured origins', () => {
    process.env.TRUSTED_ORIGINS = ' https://custom.example.com ,https://custom.example.com '

    expect(getTrustedOrigins().filter((origin) => origin === 'https://custom.example.com')).toHaveLength(1)

    delete process.env.TRUSTED_ORIGINS
  })
})
