// Owner-run only. No remote imports, secrets, assets, RPCs, or mutations.
// Client model verified at 260bb338d74daa91c35cabf0c9a377539a539c24.
import http from 'k6/http'
import { sleep } from 'k6'
import exec from 'k6/execution'
import { Counter, Gauge, Rate, Trend } from 'k6/metrics'

const BASE = 'https://awwalha.vercel.app'
const CLOCK_PROBE = __ENV.CLOCK_PROBE === '1'
const EXPECTED_SHA = '260bb338d74daa91c35cabf0c9a377539a539c24'
const endpointMetrics = {}
for (const endpoint of ['state', 'time']) {
  endpointMetrics[endpoint] = {
    requests: new Counter(`${endpoint}_requests`),
    successes: new Counter(`${endpoint}_successful_responses`),
    success: new Rate(`${endpoint}_success`),
    duration: new Trend(`${endpoint}_duration`, true),
  }
}
const statuses = {}
for (const status of ['200', '429', '500', '502', '503', '504', '520', '522', 'other_http']) {
  statuses[status] = new Counter(`response_status_${status}`)
}
const network = {}
for (const kind of ['reset', 'tls', 'timeout', 'dns', 'connection', 'other']) {
  network[kind] = new Counter(`network_${kind}`)
}
const networkErrors = new Counter('load_generator_network_errors')
const httpFailures = new Counter('http_response_failures')
const serverErrors = new Counter('server_5xx')
const payloadErrors = new Counter('invalid_payloads')
const cache = {}
for (const kind of ['HIT', 'STALE', 'MISS', 'OTHER']) cache[kind] = new Counter(`state_cache_${kind.toLowerCase()}`)
const activeVus = new Gauge('active_audience_vus')
const fullTierPolls = new Counter('state_polls_at_750_vus')

export const options = {
  scenarios: {
    audience: {
      executor: 'ramping-vus', startVUs: 0, gracefulRampDown: '15s',
      stages: [
        { duration: '15s', target: 50 }, { duration: '45s', target: 50 },
        { duration: '15s', target: 100 }, { duration: '45s', target: 100 },
        { duration: '15s', target: 250 }, { duration: '45s', target: 250 },
        { duration: '15s', target: 500 }, { duration: '45s', target: 500 },
        { duration: '15s', target: 750 }, { duration: '45s', target: 750 },
        { duration: '15s', target: 0 },
      ],
    },
  },
  setupTimeout: '25s',
  maxRedirects: 0, // Never follow an unexpected redirect to another path.
  summaryTrendStats: ['min', 'med', 'p(50)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    http_req_failed: ['rate<0.001'],
    state_success: ['rate>=0.999'],
    state_duration: ['p(95)<1000'],
    server_5xx: [{ threshold: 'count==0', abortOnFail: true }],
    load_generator_network_errors: [{ threshold: 'count==0', abortOnFail: true }],
    invalid_payloads: [{ threshold: 'count==0', abortOnFail: true }],
    state_polls_at_750_vus: ['count>=3000'],
    ...(CLOCK_PROBE ? { time_success: ['rate>=0.999'], time_duration: ['p(95)<1500'] } : {}),
  },
}
// Materialize endpoint-specific distributions in the exported summary.
for (const name of [...Object.keys(statuses).map(key => `response_status_${key}`), ...Object.keys(network).map(key => `network_${key}`)]) {
  for (const endpoint of ['state', 'time']) options.thresholds[`${name}{endpoint:${endpoint}}`] = ['count>=0']
}

function classifyNetwork(response) {
  const code = Number(response.error_code || 0)
  const error = String(response.error || '').toLowerCase()
  if (code === 1220 || /reset|econnreset/.test(error)) return 'reset'
  if (/timeout|timed out|deadline/.test(error) || code === 1050 || code === 1211) return 'timeout'
  if ((code >= 1100 && code < 1200) || /dns|no such host|lookup/.test(error)) return 'dns'
  if ((code >= 1300 && code < 1400) || /tls|ssl|certificate/.test(error)) return 'tls'
  if ((code >= 1200 && code < 1300) || /connection|dial tcp|refused/.test(error)) return 'connection'
  return 'other'
}

function read(endpoint, scope = 'audience') {
  if (!['state', 'time'].includes(endpoint)) throw new Error('Read-only path allowlist violation')
  const response = http.get(`${BASE}/api/${endpoint}`, {
    redirects: 0, timeout: '10s',
    headers: { Accept: 'application/json', ...(endpoint === 'time' ? { 'Cache-Control': 'no-cache' } : {}) },
    tags: { endpoint, scope, name: `/api/${endpoint}` },
  })
  let payload = null
  try { payload = response.json() } catch { /* Count malformed HTTP 200 separately. */ }
  const valid = endpoint === 'state'
    ? !!payload && Number.isFinite(payload.stateVersion) && payload.stateVersion > 0
      && payload.phase === 'lobby' && payload.round === null && payload.registrationOpen === false
    : !!payload && Number.isFinite(payload.epochMs)
  const ok = response.status === 200 && valid

  if (scope === 'audience') {
    const tags = { endpoint }
    const metrics = endpointMetrics[endpoint]
    metrics.requests.add(1)
    metrics.successes.add(ok ? 1 : 0)
    metrics.success.add(ok)
    // HTTP response timing only; status=0 is a local transport failure, not HTTP latency.
    if (response.status > 0) metrics.duration.add(response.timings.duration)
    for (const [status, metric] of Object.entries(statuses)) {
      const matches = status === 'other_http'
        ? response.status > 0 && !statuses[String(response.status)]
        : response.status === Number(status)
      metric.add(matches ? 1 : 0, tags)
    }
    const isNetwork = response.status === 0
    const category = isNetwork ? classifyNetwork(response) : null
    networkErrors.add(isNetwork ? 1 : 0)
    for (const [kind, metric] of Object.entries(network)) metric.add(kind === category ? 1 : 0, tags)
    httpFailures.add(response.status >= 400 ? 1 : 0)
    serverErrors.add(response.status >= 500 ? 1 : 0)
    payloadErrors.add(response.status === 200 && !valid ? 1 : 0)
    if (endpoint === 'state') {
      const header = Object.keys(response.headers).find(key => key.toLowerCase() === 'x-vercel-cache')
      const value = String(header ? response.headers[header] : '').toUpperCase()
      for (const [kind, metric] of Object.entries(cache)) metric.add((kind === value || (kind === 'OTHER' && !cache[value])) ? 1 : 0)
    }
  }

  if (!ok) {
    const detail = response.status === 0
      ? `LOAD GENERATOR NETWORK ERROR (${classifyNetwork(response)}): ${response.error_code} ${response.error}`
      : `HTTP ${response.status}${response.status === 200 ? ': unsafe/non-idle or invalid payload' : ''}`
    // Stop instead of ramping on a broken runner, live round, or unhealthy endpoint.
    exec.test.abort(`${scope} /api/${endpoint}: ${detail}`)
  }
  return { response, payload, ok }
}

export function setup() {
  if (__ENV.CONFIRMED_SHA !== EXPECTED_SHA) throw new Error(`Verify Production SHA in Vercel, then set CONFIRMED_SHA=${EXPECTED_SHA}`)
  console.log(JSON.stringify({ startedAt: new Date().toISOString(), base: BASE, expectedSha: EXPECTED_SHA, maxVUs: 750, clockProbe: CLOCK_PROBE }))
  read('state', 'preflight')
  read('time', 'preflight') // One health probe, excluded from audience endpoint metrics.
}

let initialized = false
export default function () {
  activeVus.add(exec.instance.vusActive)
  const first = !initialized
  initialized = true
  read('state')
  fullTierPolls.add(exec.instance.vusActive >= 750 ? 1 : 0)
  if (first && CLOCK_PROBE) {
    // Optional supplemental clock test, NOT normal idle traffic.
    // Play enables this only when Boolean(round?.startsAt) becomes true.
    sleep((300 + Math.random() * 2200) / 1000)
    for (let sample = 0; sample < 3; sample++) {
      if (sample) sleep((120 + Math.random() * 280) / 1000)
      read('time')
    }
  }
  // All clients remain visible: conservative audience upper bound.
  // No overlapping state requests, no retries, no cache-busting query string.
  sleep(Math.round(6000 + Math.random() * 4000) / 1000)
}

export function handleSummary(data) {
  const values = name => data.metrics[name] ? data.metrics[name].values : {}
  const count = name => values(name).count || 0
  const endpointSummary = endpoint => ({
    requests: count(`${endpoint}_requests`), successfulResponses: count(`${endpoint}_successful_responses`),
    successPercent: count(`${endpoint}_requests`) ? (values(`${endpoint}_success`).rate || 0) * 100 : null,
    httpLatencyMs: values(`${endpoint}_duration`),
    statusDistribution: Object.fromEntries(Object.keys(statuses).map(status => [status, count(`response_status_${status}{endpoint:${endpoint}}`)])),
    networkErrors: Object.fromEntries(Object.keys(network).map(kind => [kind, count(`network_${kind}{endpoint:${endpoint}}`)])),
  })
  const report = {
    endedAt: new Date().toISOString(), expectedSha: EXPECTED_SHA, clockProbe: CLOCK_PROBE,
    maxObservedVUs: values('active_audience_vus').max || 0,
    statePollsAt750VUs: count('state_polls_at_750_vus'),
    state: endpointSummary('state'), time: endpointSummary('time'),
    timeNote: CLOCK_PROBE ? 'Supplemental one-off three-sample sync per VU; not idle traffic.' : 'No audience time requests: Lobby does not enable useClockSync. One setup health probe excluded.',
    cache: Object.fromEntries(Object.keys(cache).map(kind => [kind, count(`state_cache_${kind.toLowerCase()}`)])),
    httpFailures: count('http_response_failures'), server5xx: count('server_5xx'),
    loadGeneratorNetworkErrors: count('load_generator_network_errors'),
    thresholds: Object.fromEntries(Object.entries(data.metrics).filter(([,metric]) => metric.thresholds).map(([name,metric]) => [name,metric.thresholds])),
    upstreamRpc: 'REQUIRES BEFORE/AFTER SUPABASE COUNTER OR COMPLETE LOG WINDOW',
    amplification: 'audience state requests / measured upstream public-state RPC delta',
    databaseErrors: 'VERIFY 57014 AND too_many_connections IN SERVER LOGS',
    finalVerdict: 'OWNER MUST VERIFY SHA, FULL 750 HOLD, HTTP/NETWORK RESULTS AND SERVER LOGS; NOT AUTOMATICALLY PRODUCTION VERIFIED',
  }
  return { stdout: `${JSON.stringify(report, null, 2)}\n`, 'load-tests/results/production-750-report.json': JSON.stringify({ report, k6: data }, null, 2) }
}
