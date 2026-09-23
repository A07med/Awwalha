export const config = { runtime: 'edge' }

const fallback = {
  stateVersion: 0,
  registrationOpen: false,
  phase: 'lobby',
  currentGame: null,
  round: null,
  registeredCount: 0,
  submittedCount: 0,
  tieEligiblePublicIds: [],
  winners: [],
  taifWinners: [],
  serverPublishedAt: new Date(0).toISOString(),
}

export default async function handler() {
  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (!url || !anonKey) return json(fallback)

  try {
    const response = await fetch(url + '/rest/v1/rpc/public_event_state', {
      method: 'POST',
      headers: {
        apikey: anonKey,
        authorization: 'Bearer ' + anonKey,
        'content-type': 'application/json',
      },
      body: '{}',
    })
    if (!response.ok) return json(fallback, 503)
    return json(await response.json())
  } catch {
    return json(fallback, 503)
  }
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, s-maxage=1, stale-while-revalidate=4',
      'x-content-type-options': 'nosniff',
    },
  })
}
