// Operator-only on-demand publication of the EXISTING shared ISR asset.
// The build emits a per-deployment token into private function output only.
export default async function publishState(request: Request, bypassToken: string) {
  const reply = (status: number, published = false) => Response.json({ published }, { status, headers: { 'cache-control': 'no-store' } })
  const started = Date.now()
  let stage = 'input'
  const fail = (reason: string, status = 503, upstreamStatus?: number) => {
    console.warn(JSON.stringify({ event: 'state_publication_failed', stage, reason, status, upstreamStatus, durationMs: Date.now() - started }))
    return reply(status)
  }
  if (request.method !== 'POST') return reply(405)
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return reply(401)
  try {
    const { roundId } = await request.json()
    if (typeof roundId !== 'string' || !/^[a-f0-9-]{36}$/i.test(roundId)) return reply(400)
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_ANON_KEY
    // Production's unique deployment hostname may require Vercel login, while
    // its public production alias does not. Only trust Vercel-provided hosts,
    // never the request's Host/origin (which could exfiltrate the ISR token).
    const host = process.env.VERCEL_ENV === 'production'
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : process.env.VERCEL_URL
    if (!url || !key || !host || !bypassToken) return fail('missing_runtime_config')
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host) || host.includes('..')) return fail('invalid_runtime_host')
    // Existing require_admin() check; participant/anon JWTs cannot publish.
    stage = 'admin_check'
    const admin = await fetch(url + '/rest/v1/rpc/admin_round_status', {
      method: 'POST', headers: { authorization, apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify({ p_round_id: roundId }), signal: AbortSignal.timeout(2000),
    })
    if (!admin.ok) return fail('admin_check_rejected', admin.status >= 500 ? 503 : 403, admin.status)
    const cookie = request.headers.get('cookie')?.split(';').map((s) => s.trim()).find((s) => s.startsWith('_vercel_jwt='))
    const headers: Record<string, string> = { accept: 'application/json', 'x-prerender-revalidate': bypassToken }
    if (cookie) headers.cookie = cookie
    stage = 'isr_revalidation'
    const refreshed = await fetch(`https://${host}/api/state`, { headers, redirect: 'manual', signal: AbortSignal.timeout(3000) })
    if (refreshed.status >= 300 && refreshed.status < 400) return fail('revalidation_redirect', 503, refreshed.status)
    if (!refreshed.ok) return fail('revalidation_http_error', 503, refreshed.status)
    stage = 'snapshot_validation'
    const state = await refreshed.json()
    if (state.round?.id !== roundId) return fail('round_mismatch', 409)
    return reply(200, true)
  } catch (reason) {
    return fail(reason instanceof Error && ['TimeoutError', 'AbortError'].includes(reason.name) ? 'upstream_timeout' : 'request_failed')
  }
}
