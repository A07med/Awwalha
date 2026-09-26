import { safePublicSnapshot } from './public-snapshot'

export const config = { runtime: 'edge' }

// Direct HTTP p99 measured 1487ms (SQL ~6ms). ISR serves its shared
// last-good copy while refreshing; do not wait for Edge's 25s limit.
export const REFRESH_TIMEOUT_MS = 2000

export default async function handler() {
  const started = performance.now()
  try {
    const url = process.env.SUPABASE_URL
    const anonKey = process.env.SUPABASE_ANON_KEY
    if (!url || !anonKey) throw new Error('configuration')
    const response = await fetch(url + '/rest/v1/rpc/public_event_state', {
      method: 'POST',
      headers: {
        apikey: anonKey,
        authorization: 'Bearer ' + anonKey,
        'content-type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error('upstream')
    const snapshot = safePublicSnapshot(await response.json())
    const ms = Math.round(performance.now() - started)
    console.info(JSON.stringify({ event: 'public_state_refresh', ok: true, ms, version: snapshot.stateVersion }))
    return new Response(JSON.stringify(snapshot), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=0, must-revalidate',
        'x-content-type-options': 'nosniff',
        'x-awwalha-state-delivery': 'isr-v1',
        'x-awwalha-snapshot-at': new Date().toISOString(),
        'server-timing': `state_refresh;dur=${ms}`,
      },
    })
  } catch {
    // Failed ISR regeneration must not overwrite the shared last-good copy
    // with a synthetic lobby. A truly cold cache has no state to invent.
    console.warn(JSON.stringify({ event: 'public_state_refresh', ok: false, ms: Math.round(performance.now() - started) }))
    return new Response(JSON.stringify({ error: 'public_state_unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  }
}
