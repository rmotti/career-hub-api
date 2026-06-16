/**
 * Minimal in-process metrics registry, exposed in Prometheus text exposition format at
 * `GET /api/metrics`. No external dependency — the three signals we care about (cache
 * hit-rate, fit-score outcomes, HTTP latency/in-flight) are plain counters/histograms.
 *
 * Multi-replica note (#19): these counters live in process memory and are PER-REPLICA.
 * That's the standard Prometheus model — the scraper hits each instance and aggregates —
 * so it does NOT violate the stateless-process invariant: nothing here affects request
 * handling or is read back as shared state; it's write-only observability that resets on
 * restart. Same accepted exception as the fit-score health counters.
 */

// Histogram buckets for HTTP request duration, in milliseconds.
const REQUEST_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]

const cache = { hits: 0, misses: 0 }
const fitScoreByOutcome = new Map<string, number>()
const httpByRoute = new Map<string, number>() // `${method}|${route}|${status}` -> count
const httpBuckets = REQUEST_BUCKETS_MS.map(() => 0)
let httpDurationSumMs = 0
let httpDurationCount = 0
let httpInFlight = 0

export function recordCacheHit(): void {
  cache.hits += 1
}

export function recordCacheMiss(): void {
  cache.misses += 1
}

export function recordFitScoreOutcome(outcome: string): void {
  fitScoreByOutcome.set(outcome, (fitScoreByOutcome.get(outcome) ?? 0) + 1)
}

export function httpRequestStarted(): void {
  httpInFlight += 1
}

export function httpRequestFinished(): void {
  httpInFlight = Math.max(0, httpInFlight - 1)
}

/** Records a finished HTTP request. `route` must be the route TEMPLATE (e.g. `/api/saves/:saveId`) to keep cardinality bounded. Does not touch the in-flight gauge — call `httpRequestFinished()` for that. */
export function recordHttpRequest(method: string, route: string, status: number, durationMs: number): void {
  const key = `${method}|${route}|${status}`
  httpByRoute.set(key, (httpByRoute.get(key) ?? 0) + 1)
  httpDurationSumMs += durationMs
  httpDurationCount += 1
  for (let i = 0; i < REQUEST_BUCKETS_MS.length; i++) {
    if (durationMs <= REQUEST_BUCKETS_MS[i]) httpBuckets[i] += 1
  }
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

/** Renders the current snapshot in Prometheus text exposition format (v0.0.4). */
export function renderMetrics(): string {
  const lines: string[] = []

  // ── Cache hit-rate ──────────────────────────────────────────────────────
  lines.push('# HELP cache_hits_total Redis cache reads that returned a value.')
  lines.push('# TYPE cache_hits_total counter')
  lines.push(`cache_hits_total ${cache.hits}`)
  lines.push('# HELP cache_misses_total Redis cache reads that returned nothing (or failed).')
  lines.push('# TYPE cache_misses_total counter')
  lines.push(`cache_misses_total ${cache.misses}`)

  // ── Fit-score outcomes (timeout rate = timeout / sum) ───────────────────
  lines.push('# HELP fit_score_calls_total Fit-score service calls by outcome.')
  lines.push('# TYPE fit_score_calls_total counter')
  for (const [outcome, count] of fitScoreByOutcome) {
    lines.push(`fit_score_calls_total{outcome="${escapeLabel(outcome)}"} ${count}`)
  }

  // ── HTTP requests by route ──────────────────────────────────────────────
  lines.push('# HELP http_requests_total HTTP requests by method, route template and status.')
  lines.push('# TYPE http_requests_total counter')
  for (const [key, count] of httpByRoute) {
    const [method, route, status] = key.split('|')
    lines.push(
      `http_requests_total{method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${escapeLabel(status)}"} ${count}`,
    )
  }

  // ── HTTP request duration histogram (ms) ────────────────────────────────
  lines.push('# HELP http_request_duration_ms HTTP request duration in milliseconds.')
  lines.push('# TYPE http_request_duration_ms histogram')
  let cumulative = 0
  for (let i = 0; i < REQUEST_BUCKETS_MS.length; i++) {
    cumulative = httpBuckets[i]
    lines.push(`http_request_duration_ms_bucket{le="${REQUEST_BUCKETS_MS[i]}"} ${cumulative}`)
  }
  lines.push(`http_request_duration_ms_bucket{le="+Inf"} ${httpDurationCount}`)
  lines.push(`http_request_duration_ms_sum ${httpDurationSumMs}`)
  lines.push(`http_request_duration_ms_count ${httpDurationCount}`)

  // ── In-flight requests (a cheap saturation proxy until Prisma pool metrics land) ──
  lines.push('# HELP http_requests_in_flight HTTP requests currently being handled.')
  lines.push('# TYPE http_requests_in_flight gauge')
  lines.push(`http_requests_in_flight ${httpInFlight}`)

  // ── Process basics (computed at scrape time — no stored state) ──────────
  const mem = process.memoryUsage()
  lines.push('# HELP process_resident_memory_bytes Resident set size in bytes.')
  lines.push('# TYPE process_resident_memory_bytes gauge')
  lines.push(`process_resident_memory_bytes ${mem.rss}`)
  lines.push('# HELP nodejs_heap_used_bytes V8 heap used in bytes.')
  lines.push('# TYPE nodejs_heap_used_bytes gauge')
  lines.push(`nodejs_heap_used_bytes ${mem.heapUsed}`)
  lines.push('# HELP process_uptime_seconds Process uptime in seconds.')
  lines.push('# TYPE process_uptime_seconds gauge')
  lines.push(`process_uptime_seconds ${Math.round(process.uptime())}`)

  return lines.join('\n') + '\n'
}

export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8'

/** Test-only: clears all accumulated metrics. */
export function __resetMetrics(): void {
  cache.hits = 0
  cache.misses = 0
  fitScoreByOutcome.clear()
  httpByRoute.clear()
  httpBuckets.fill(0)
  httpDurationSumMs = 0
  httpDurationCount = 0
  httpInFlight = 0
}
