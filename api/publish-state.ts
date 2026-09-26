// Operator-only on-demand publication of the EXISTING shared ISR asset.
// The build emits a per-deployment token into private function output only.
export default async function publishState(request: Request, bypassToken: string) {
  const reply = (status: number, published = false) => Response.json({ published }, { status, headers: { 'cache-control': 'no-store' } })
  if (request.method !== 'POST') return reply(405)
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return reply(401)
  try {
    const { roundId } = await request.json()
    if (typeof roundId !== 'string' || !/^[a-f0-9-]{36}$/i.test(roundId)) return reply(400)
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_ANON_KEY
    const host = process.env.VERCEL_URL
    if (!url || !key || !host || !bypassToken) return reply(503)
    // Existing require_admin() check; participant/anon JWTs cannot publish.
    const admin = await fetch(url + '/rest/v1/rpc/admin_round_status', {
      method: 'POST', headers: { authorization, apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify({ p_round_id: roundId }), signal: AbortSignal.timeout(2000),
    })
    if (!admin.ok) return reply(403)
    const cookie = request.headers.get('cookie')?.split(';').map((s) => s.trim()).find((s) => s.startsWith('_vercel_jwt='))
    const headers: Record<string, string> = { accept: 'application/json', 'x-prerender-revalidate': bypassToken }
    if (cookie) headers.cookie = cookie
    const refreshed = await fetch(`https://${host}/api/state`, { headers, redirect: 'error', signal: AbortSignal.timeout(3000) })
    if (!refreshed.ok) return reply(503)
    const state = await refreshed.json()
    return reply(state.round?.id === roundId ? 200 : 409, state.round?.id === roundId)
  } catch { return reply(503) }
}
