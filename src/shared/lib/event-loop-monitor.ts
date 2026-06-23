import { monitorEventLoopDelay } from 'perf_hooks'
import type { FastifyBaseLogger } from 'fastify'

/**
 * TEMPORARY DIAGNOSTIC (#perf-investigation). Measures event-loop lag with a high-resolution
 * histogram and logs whenever the loop is blocked beyond `thresholdMs`. If the loop is healthy
 * the numbers stay near 0; sustained high lag with low CPU means the process is being frozen
 * (GC stop-the-world or a synchronous blocking call), which is exactly the symptom we're chasing:
 * trivial routes (like `/`) taking seconds while CPU sits at ~0.
 *
 * Remove this once the slow-TTFB cause is found.
 */
export function startEventLoopMonitor(log: FastifyBaseLogger, opts: { intervalMs?: number; thresholdMs?: number } = {}) {
  const intervalMs = opts.intervalMs ?? 2000
  const thresholdMs = opts.thresholdMs ?? 100

  // resolution: sampling granularity in ms. The histogram accumulates delay between scheduled
  // and actual timer fires — i.e. how late the loop is.
  const h = monitorEventLoopDelay({ resolution: 20 })
  h.enable()

  const timer = setInterval(() => {
    const maxMs = h.max / 1e6 // ns → ms
    const p99Ms = h.percentile(99) / 1e6
    const meanMs = h.mean / 1e6

    if (maxMs >= thresholdMs) {
      log.warn(
        {
          evtLoopMaxMs: Math.round(maxMs),
          evtLoopP99Ms: Math.round(p99Ms),
          evtLoopMeanMs: Math.round(meanMs * 100) / 100,
          rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
          heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        },
        'event-loop blocked',
      )
    }
    h.reset()
  }, intervalMs)

  // Don't keep the process alive just for this monitor.
  timer.unref()

  return () => {
    clearInterval(timer)
    h.disable()
  }
}
