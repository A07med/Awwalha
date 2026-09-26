import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { demoPerfectState } from '../lib/demo-state'
import { AdminPage } from './admin'
const mocks = vi.hoisted(() => ({ state: null as unknown as typeof demoPerfectState, count: 4,
  close: vi.fn(), resolve: vi.fn(), tie: vi.fn(), reveal: vi.fn(), refresh: vi.fn(), setState: vi.fn(), summary: vi.fn(), accept: vi.fn(), registration: vi.fn() }))
vi.mock('qrcode', () => ({ default: { toDataURL: async () => '' } }))
vi.mock('../hooks/use-public-state', () => ({ usePublicState: () => ({ state: mocks.state, refresh: mocks.refresh, setState: mocks.setState }) }))
vi.mock('../hooks/use-operator-round-status', () => ({ useOperatorRoundStatus: () => ({ submittedCount: mocks.count, error: null }) }))
vi.mock('../lib/api', () => ({ adminCloseRound: mocks.close, adminResolveRound: mocks.resolve, adminStartTieBreak: mocks.tie, adminRevealWinners: mocks.reveal,
  adminClearRegistrations: vi.fn(), adminPrepareRound: vi.fn(), adminPrepareTaif: vi.fn(), adminResetGames: vi.fn(), adminSetRegistration: mocks.registration, adminStartTaif: vi.fn(), adminFirstLookSummary: mocks.summary, adminAcceptFirstLookTie: mocks.accept }))
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('VITE_APP_MODE', 'supabase')
  mocks.state = structuredClone(demoPerfectState); mocks.state.stateVersion = 100
  mocks.state.round!.closesAt = '2026-01-01T00:00:00Z'; mocks.state.submittedCount = 0
  mocks.close.mockResolvedValue({}); mocks.resolve.mockResolvedValue({ tiedCount: 0, remainingSeats: 0 })
  mocks.setState.mockImplementation((updater) => { mocks.state = updater(mocks.state) })
  mocks.summary.mockResolvedValue(null)
})
it('shows First Look score groups and both choices with explicit accept-all confirmation', async () => {
  mocks.state.currentGame = mocks.state.round!.gameType = 'first_look'
  mocks.state.round!.phase = 'resolved'; mocks.state.phase = 'tie_break'
  const value = { roundId: mocks.state.round!.id, submittedCount: 5, configuredTarget: 3, lockedCount: 2, cutoffScore: 2, tiedCount: 3, remainingSeats: 1, projectedWinnerCount: 5, tieNeeded: true, groups: [{ score: 0, count: 1 }, { score: 1, count: 1 }, { score: 2, count: 3 }] }
  mocks.summary.mockResolvedValue(value)
  mocks.accept.mockResolvedValue({ winnerCount: 5 })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(<AdminPage />)
  const accept = await screen.findByRole('button', { name: 'اعتماد جميع المتعادلين كفائزين' })
  expect(screen.getByText('سيصبح عدد الفائزين 5 بدلاً من 3')).toBeInTheDocument()
  expect(screen.getByText('الفارق 2: 3 مشاركين')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'إجراء جولة فاصلة' })).toBeEnabled()
  fireEvent.click(accept); expect(mocks.accept).not.toHaveBeenCalled()
  confirm.mockReturnValue(true); fireEvent.click(accept); fireEvent.click(accept)
  await waitFor(() => expect(mocks.accept).toHaveBeenCalledTimes(1))
  expect(confirm).toHaveBeenCalledWith('سيصبح عدد الفائزين 5 بدلاً من 3')
  confirm.mockRestore()
})
it('deduplicates registration clicks and never reports successful closure on backend failure', async () => {
  mocks.registration.mockRejectedValue(new Error('admin_required'))
  render(<AdminPage />)
  const button = screen.getByRole('button', { name: 'إغلاق التسجيل' })
  fireEvent.click(button); fireEvent.click(button)
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  expect(mocks.registration).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('تم إغلاق التسجيل')).not.toBeInTheDocument()
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
