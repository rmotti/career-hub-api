import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetMetrics,
  httpRequestFinished,
  httpRequestStarted,
  recordCacheHit,
  recordCacheMiss,
  recordFitScoreOutcome,
  recordHttpRequest,
  renderMetrics,
} from '../metrics.js'

beforeEach(() => {
  __resetMetrics()
})

describe('metrics', () => {
  it('renders cache hit/miss counters', () => {
    recordCacheHit()
    recordCacheHit()
    recordCacheMiss()

    const out = renderMetrics()
    expect(out).toContain('cache_hits_total 2')
    expect(out).toContain('cache_misses_total 1')
  })

  it('renders fit-score outcomes as labeled counters', () => {
    recordFitScoreOutcome('ok')
    recordFitScoreOutcome('ok')
    recordFitScoreOutcome('timeout')

    const out = renderMetrics()
    expect(out).toContain('fit_score_calls_total{outcome="ok"} 2')
    expect(out).toContain('fit_score_calls_total{outcome="timeout"} 1')
  })

  it('records http requests with bounded route-template labels and a histogram', () => {
    recordHttpRequest('GET', '/api/saves/:saveId', 200, 12)
    recordHttpRequest('GET', '/api/saves/:saveId', 200, 300)
    recordHttpRequest('POST', '/api/saves', 201, 8)

    const out = renderMetrics()
    expect(out).toContain('http_requests_total{method="GET",route="/api/saves/:saveId",status="200"} 2')
    expect(out).toContain('http_requests_total{method="POST",route="/api/saves",status="201"} 1')

    // histogram: le=25 catches the 12ms + 8ms requests (2), le=500 catches all 3
    expect(out).toContain('http_request_duration_ms_bucket{le="25"} 2')
    expect(out).toContain('http_request_duration_ms_bucket{le="500"} 3')
    expect(out).toContain('http_request_duration_ms_bucket{le="+Inf"} 3')
    expect(out).toContain('http_request_duration_ms_count 3')
    expect(out).toContain('http_request_duration_ms_sum 320')
  })

  it('tracks the in-flight gauge', () => {
    httpRequestStarted()
    httpRequestStarted()
    httpRequestFinished()

    expect(renderMetrics()).toContain('http_requests_in_flight 1')
  })

  it('never lets the in-flight gauge go negative', () => {
    httpRequestFinished()
    expect(renderMetrics()).toContain('http_requests_in_flight 0')
  })

  it('escapes quotes in label values', () => {
    recordFitScoreOutcome('we"ird')
    expect(renderMetrics()).toContain('fit_score_calls_total{outcome="we\\"ird"} 1')
  })

  it('emits valid HELP/TYPE lines and a trailing newline', () => {
    const out = renderMetrics()
    expect(out).toContain('# TYPE cache_hits_total counter')
    expect(out).toContain('# TYPE http_request_duration_ms histogram')
    expect(out).toContain('# TYPE http_requests_in_flight gauge')
    expect(out.endsWith('\n')).toBe(true)
  })
})
