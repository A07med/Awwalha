import { cleanup, render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AdminGuard } from './admin-guard'
const mocks = vi.hoisted(() => ({ verify: vi.fn(), unsubscribe: vi.fn(), onAuth: null as null | ((event: string) => void) }))
vi.mock('../lib/api', () => ({ verifyAdminAccess: mocks.verify, supabase: { auth: { onAuthStateChange: (callback: (event: string) => void) => { mocks.onAuth = callback; return { data: { subscription: { unsubscribe: mocks.unsubscribe } } } } } } }))
beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)
function view() { return render(<MemoryRouter initialEntries={['/admin']}><Routes><Route path="/admin" element={<AdminGuard><div>PRIVATE ADMIN</div></AdminGuard>} /><Route path="/admin/login" element={<div>LOGIN</div>} /></Routes></MemoryRouter>) }
it('redirects a missing session to admin login', async () => {
  mocks.verify.mockResolvedValue('unauthenticated'); view()
  expect(await screen.findByText('LOGIN')).toBeInTheDocument()
  expect(screen.queryByText('PRIVATE ADMIN')).not.toBeInTheDocument()
})
it('denies authenticated non-admins with a clear Arabic authorization error', async () => {
  mocks.verify.mockResolvedValue('forbidden'); view()
  expect(await screen.findByRole('alert')).toHaveTextContent('غير مخوّل')
  expect(screen.queryByText('PRIVATE ADMIN')).not.toBeInTheDocument()
})
it('allows only verified members and unsubscribes on unmount', async () => {
  mocks.verify.mockResolvedValue('allowed'); const rendered = view()
  expect(await screen.findByText('PRIVATE ADMIN')).toBeInTheDocument()
  rendered.unmount(); expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
})
it('fails closed when membership verification fails', async () => {
  mocks.verify.mockRejectedValue(new Error('network')); view()
  expect(await screen.findByRole('alert')).toHaveTextContent('تعذر التحقق')
  expect(screen.queryByText('PRIVATE ADMIN')).not.toBeInTheDocument()
})
it('immediately hides admin content on auth changes and ignores stale identity verification', async () => {
  let finish!: (value: string) => void
  mocks.verify.mockReturnValueOnce(new Promise((resolve) => { finish = resolve })).mockResolvedValue('forbidden')
  view()
  await act(async () => { mocks.onAuth!('SIGNED_IN') })
  expect(await screen.findByRole('alert')).toHaveTextContent('غير مخوّل')
  await act(async () => { finish('allowed') })
  expect(screen.queryByText('PRIVATE ADMIN')).not.toBeInTheDocument()
  await waitFor(() => expect(mocks.verify).toHaveBeenCalledTimes(2))
})
