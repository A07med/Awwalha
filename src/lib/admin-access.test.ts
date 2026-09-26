import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), abortSignal: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getSession: mocks.session }, rpc: mocks.rpc }) }))
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks()
  vi.stubEnv('VITE_APP_MODE', 'supabase'); vi.stubEnv('VITE_SUPABASE_URL', 'https://segymjevvgjywvqqjgyk.supabase.co'); vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public')
  mocks.rpc.mockReturnValue({ abortSignal: mocks.abortSignal })
})
afterEach(() => vi.unstubAllEnvs())
it('never checks membership without a session', async () => {
  mocks.session.mockResolvedValue({ data: { session: null }, error: null })
  const { verifyAdminAccess } = await import('./api')
  expect(await verifyAdminAccess()).toBe('unauthenticated'); expect(mocks.rpc).not.toHaveBeenCalled()
})
it.each([[true, 'allowed'], [false, 'forbidden']] as const)('checks secure is_admin boolean %s without reading admin lists', async (member, expected) => {
  mocks.session.mockResolvedValue({ data: { session: {} }, error: null })
  mocks.abortSignal.mockResolvedValue({ data: member, error: null, status: 200 })
  const { verifyAdminAccess } = await import('./api')
  expect(await verifyAdminAccess()).toBe(expected); expect(mocks.rpc).toHaveBeenCalledWith('is_admin')
})
it('preserves actual RPC HTTP status/code for deterministic error classification', async () => {
  mocks.abortSignal.mockResolvedValue({ data: null, error: { code: '22023', message: 'invalid_round' }, status: 400 })
  const { adminRoundStatus } = await import('./api')
  await expect(adminRoundStatus('stale', new AbortController().signal)).rejects.toMatchObject({ message: 'invalid_round', code: '22023', status: 400 })
})
it('requires reauthentication for expired auth', async () => {
  mocks.session.mockResolvedValue({ data: { session: {} }, error: null })
  mocks.abortSignal.mockResolvedValue({ data: null, error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 })
  const { verifyAdminAccess } = await import('./api')
  expect(await verifyAdminAccess()).toBe('unauthenticated')
})
