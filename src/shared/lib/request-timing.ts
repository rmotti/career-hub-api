import type { FastifyInstance } from 'fastify'

/**
 * TEMPORARY DIAGNOSTIC (#perf-investigation). Records a timestamp at each Fastify lifecycle phase
 * and, for any request slower than `thresholdMs`, logs the per-phase breakdown. This pinpoints WHERE
 * the seconds go: if the gap is between `onRequest` and `preHandler`, it's auth/CSRF/parsing; if it's
 * inside the handler, it's the route's own I/O; if `onRequest` itself fires late, the loop was blocked
 * before the request was even picked up.
 *
 * Phases (ms since onRequest):
 *   reqStart  → onRequest fired (entry)
 *   validated → preValidation
 *   preHandler→ auth/CSRF done, about to run handler
 *   sent      → onSend (handler done, serializing)
 *   done      → onResponse (response flushed)
 *
 * Remove this once the slow-TTFB cause is found.
 */
const KEY = Symbol('reqTiming')

type Marks = { start: bigint; validated?: bigint; preHandler?: bigint; sent?: bigint }

function ms(from: bigint, to: bigint): number {
  return Math.round(Number(to - from) / 1e6)
}

export function registerRequestTiming(app: FastifyInstance, opts: { thresholdMs?: number } = {}) {
  const thresholdMs = opts.thresholdMs ?? 500

  app.addHook('onRequest', (req, _reply, done) => {
    ;(req as unknown as Record<symbol, Marks>)[KEY] = { start: process.hrtime.bigint() }
    done()
  })

  app.addHook('preValidation', (req, _reply, done) => {
    const m = (req as unknown as Record<symbol, Marks>)[KEY]
    if (m) m.validated = process.hrtime.bigint()
    done()
  })

  app.addHook('preHandler', (req, _reply, done) => {
    const m = (req as unknown as Record<symbol, Marks>)[KEY]
    if (m) m.preHandler = process.hrtime.bigint()
    done()
  })

  app.addHook('onSend', (req, _reply, payload, done) => {
    const m = (req as unknown as Record<symbol, Marks>)[KEY]
    if (m) m.sent = process.hrtime.bigint()
    done(null, payload)
  })

  app.addHook('onResponse', (req, reply, done) => {
    const m = (req as unknown as Record<symbol, Marks>)[KEY]
    if (m) {
      const end = process.hrtime.bigint()
      const total = ms(m.start, end)
      if (total >= thresholdMs) {
        req.log.warn(
          {
            route: req.routeOptions?.url ?? req.url,
            method: req.method,
            status: reply.statusCode,
            totalMs: total,
            // gap from entry to each phase
            toValidationMs: m.validated ? ms(m.start, m.validated) : null,
            toPreHandlerMs: m.preHandler ? ms(m.start, m.preHandler) : null,
            handlerMs: m.preHandler && m.sent ? ms(m.preHandler, m.sent) : null,
            serializeFlushMs: m.sent ? ms(m.sent, end) : null,
            elapsedTimeMs: Math.round(reply.elapsedTime),
          },
          'slow request breakdown',
        )
      }
    }
    done()
  })
}
