// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import publish from './publish-state'

const roundId = '44444444-0000-0000-0000-000000000001'
const req = (authorization = 'Bearer admin', body = { roundId }) => new Request('https://preview/api/publish-state', { method: 'POST', headers: { authorization, 'content-type': 'application/json', cookie: '_vercel_jwt=testing; unrelated=secret' }, body: JSON.stringify(body) })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
function env() {
  vi.stubEnv('SUPABASE_URL', 'https://segymjevvgjywvqqjgyk.supabase.co')
  vi.stubEnv('SUPABASE_ANON_KEY', 'public')
  vi.stubEnv('VERCEL_URL', 'preview.vercel.app')
}
it('rejects unauthenticated requests before fetching', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  expect((await publish(req(''), 'private')).status).toBe(401)
  expect(fetcher).not.toHaveBeenCalled()
})
it('requires the existing database admin check before revalidating', async () => {
  env()
  const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 403 })); vi.stubGlobal('fetch', fetcher)
  expect((await publish(req('Bearer participant'), 'private')).status).toBe(403)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('publishes only the shared state asset, keeping the token and snapshot out of its response', async () => {
  env()
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ submittedCount: 0 })).mockResolvedValueOnce(Response.json({ round: { id: roundId } }))
  vi.stubGlobal('fetch', fetcher)
  const response = await publish(req(), 'private')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ published: true })
  expect(fetcher.mock.calls[1][0]).toBe('https://preview.vercel.app/api/state')
  expect(fetcher.mock.calls[1][1].headers).toEqual({ accept: 'application/json', 'x-prerender-revalidate': 'private', cookie: '_vercel_jwt=testing' })
})
it('does not confirm stale or wrong-round publication', async () => {
  env(); vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(Response.json({ round: { id: 'previous' } })))
  expect((await publish(req(), 'private')).status).toBe(409)
})
it('fails safely without replacing the last good cached state', async () => {
  env(); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
  const response = await publish(req(), 'private')
  expect(response.status).toBe(503)
  expect(response.headers.get('cache-control')).toBe('no-store')
})
