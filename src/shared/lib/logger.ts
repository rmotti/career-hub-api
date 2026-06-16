import pino from 'pino'

/**
 * Logger for contexts OUTSIDE a Fastify request — leaf modules like the
 * fit-score client, which don't have access to `request.log`. Same output as Fastify's
 * logger: JSON on stdout, captured by Railway in production. Silenced
 * in test so it doesn't pollute the suite output.
 *
 * Inside routes/handlers keep using `request.log` — don't use this one.
 */
export const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL ?? 'info'),
  base: undefined, // no pid/hostname — lean log
})
