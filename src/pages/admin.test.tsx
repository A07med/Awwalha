import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { demoPerfectState } from '../lib/demo-state'
import { AdminPage } from './admin'
const mocks = vi.hoisted(() => ({ state: null as unknown as typeof demoPerfectState, count: 4,
  close: vi.fn(), resolve: vi.fn(), tie: vi.fn(), reveal: vi.fn(), refresh: vi.fn(), setState: vi.fn() }))
vi.mock('qrcode', () => ({ default: { toDataURL: async () => '' } }))
vi.mock('../hooks/use-public-state', () => ({ usePublicState: () => ({ state: mocks.state, refresh: mocks.refresh, setState: mocks.setState }) }))
vi.mock('../hooks/use-operator-round-status', () => ({ useOperatorRoundStatus: () => ({ submittedCount: mocks.count, error: null }) }))
vi.mock('../lib/api', () => ({ adminCloseRound: mocks.close, adminResolveRound: mocks.resolve, adminStartTieBreak: mocks.tie, adminRevealWinners: mocks.reveal,
  adminClearRegistrations: vi.fn(), adminPrepareRound: vi.fn(), adminPrepareTaif: vi.fn(), adminResetGames: vi.fn(), adminSetRegistration: vi.fn(), adminStartTaif: vi.fn() }))
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('VITE_APP_MODE', 'supabase')
  mocks.state = structuredClone(demoPerfectState); mocks.state.stateVersion = 100
  mocks.state.round!.closesAt = '2026-01-01T00:00:00Z'; mocks.state.submittedCount = 0
  mocks.close.mockResolvedValue({}); mocks.resolve.mockResolvedValue({ tiedCount: 0, remainingSeats: 0 })
  mocks.setState.mockImplementation((updater) => { mocks.state = updater(mocks.state) })
})
afterEach(() => { cleanup(); vi.unstubAllEnvs() })
it('shows authenticated count, gates close → resolve → reveal, and hides unnecessary tie-break', async () => {
  const view = render(<AdminPage />)
  expect(screen.getByText('الإرساليات: 4')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'حساب النتيجة' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'كشف الفائزين' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'جولة فاصلة' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'إغلاق' }))
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  view.rerender(<AdminPage />)
  expect(screen.getByRole('button', { name: 'إغلاق' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'حساب النتيجة' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'حساب النتيجة' }))
  await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2))
  view.rerender(<AdminPage />)
  expect(screen.getByRole('button', { name: 'كشف الفائزين' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'جولة فاصلة' })).not.toBeInTheDocument()
})
it('only offers tie-break for the backend-confirmed tie phase', () => {
  mocks.state.round!.phase = 'resolved'; mocks.state.phase = 'tie_break'; mocks.state.tieEligiblePublicIds = []
  render(<AdminPage />)
  expect(screen.getByRole('button', { name: 'جولة فاصلة' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'كشف الفائزين' })).toBeDisabled()
})
it('prevents duplicate actions while a request is pending and translates backend errors', async () => {
  let reject!: (reason: Error) => void
  mocks.close.mockReturnValue(new Promise((_, fail) => { reject = fail }))
  render(<AdminPage />)
  const button = screen.getByRole('button', { name: 'إغلاق' })
  fireEvent.click(button); fireEvent.click(button)
  expect(mocks.close).toHaveBeenCalledTimes(1); expect(button).toBeDisabled()
  reject(new Error('round_not_closeable'))
  expect(await screen.findByText('الجولة مغلقة بالفعل أو لا يمكن إغلاقها الآن')).toBeInTheDocument()
})
it('uses operator ready count rather than the stale public count to enable Wahaj start', () => {
  mocks.state.currentGame = mocks.state.round!.gameType = 'taif'; mocks.state.round!.phase = 'preparing'
  render(<AdminPage />)
  fireEvent.click(screen.getByRole('button', { name: 'وَهَج' }))
  expect(screen.getByRole('button', { name: 'ابدأ وَهَج' })).toBeEnabled()
})
