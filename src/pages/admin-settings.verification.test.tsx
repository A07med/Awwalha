import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { demoLobbyState } from '../lib/demo-state'
import { AdminPage } from './admin'

// Verification only: every backend boundary is mocked; no Production requests.
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), refresh: vi.fn() }))
vi.mock('qrcode', () => ({ default: { toDataURL: async () => '' } }))
vi.mock('../hooks/use-public-state', () => ({ usePublicState: () => ({ state: demoLobbyState, refresh: mocks.refresh, setState: vi.fn() }) }))
vi.mock('../hooks/use-operator-round-status', () => ({ useOperatorRoundStatus: () => ({ submittedCount: 0, error: null }) }))
vi.mock('../lib/api', () => ({
  adminPrepareRound: mocks.prepare, adminFirstLookSummary: vi.fn(), adminAcceptFirstLookTie: vi.fn(),
  adminClearRegistrations: vi.fn(), adminCloseRound: vi.fn(), adminPrepareTaif: vi.fn(),
  adminResetGames: vi.fn(), adminSetRegistration: vi.fn(), adminStartTaif: vi.fn(),
  adminStartTieBreak: vi.fn(), adminResolveRound: vi.fn(), adminRevealWinners: vi.fn(),
}))
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('VITE_APP_MODE', 'supabase'); mocks.prepare.mockResolvedValue({}) })
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

it('sends the operator-selected Perfect Second hide duration', async () => {
  render(<AdminPage />)
  fireEvent.change(screen.getByRole('combobox', { name: 'إخفاء العداد بعد' }), { target: { value: '2000' } })
  fireEvent.click(screen.getByRole('button', { name: 'إعداد الجولة' }))
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1))
  expect(mocks.prepare.mock.calls[0][0].hideTimerAfterMs).toBe(2000)
})

it.each(['seeds', 'leaves', 'fish', 'bubbles'])('sends the operator-selected First Look category %s', async (category) => {
  render(<AdminPage />)
  fireEvent.click(screen.getByRole('button', { name: 'أول نظرة' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'فئة العناصر' }), { target: { value: category } })
  fireEvent.click(screen.getByRole('button', { name: 'إعداد الجولة' }))
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1))
  expect(mocks.prepare.mock.calls[0][0].visualCategory).toBe(category)
})

it.each([1500, 1800, 2000, 3000, 4000, 5000])('sends the operator-selected First Look display duration %i', async (duration) => {
  render(<AdminPage />)
  fireEvent.click(screen.getByRole('button', { name: 'أول نظرة' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'مدة العرض' }), { target: { value: String(duration) } })
  fireEvent.click(screen.getByRole('button', { name: 'إعداد الجولة' }))
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1))
  expect(mocks.prepare.mock.calls[0][0].displayDurationMs).toBe(duration)
})

it('resolves random to a supported category before sending the round', async () => {
  render(<AdminPage />)
  fireEvent.click(screen.getByRole('button', { name: 'أول نظرة' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'فئة العناصر' }), { target: { value: 'random' } })
  fireEvent.click(screen.getByRole('button', { name: 'إعداد الجولة' }))
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1))
  expect(['seeds', 'leaves', 'fish', 'bubbles']).toContain(mocks.prepare.mock.calls[0][0].visualCategory)
})

it('retains independent game settings when switching tabs', async () => {
  render(<AdminPage />)
  fireEvent.change(screen.getByRole('combobox', { name: 'إخفاء العداد بعد' }), { target: { value: '2000' } })
  fireEvent.click(screen.getByRole('button', { name: 'أول نظرة' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'فئة العناصر' }), { target: { value: 'fish' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'مدة العرض' }), { target: { value: '5000' } })
  fireEvent.click(screen.getByRole('button', { name: 'الثانية المثالية' }))
  expect(screen.getByRole('combobox', { name: 'إخفاء العداد بعد' })).toHaveValue('2000')
  fireEvent.click(screen.getByRole('button', { name: 'أول نظرة' }))
  expect(screen.getByRole('combobox', { name: 'فئة العناصر' })).toHaveValue('fish')
  expect(screen.getByRole('combobox', { name: 'مدة العرض' })).toHaveValue('5000')
  fireEvent.click(screen.getByRole('button', { name: 'إعداد الجولة' }))
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1))
  expect(mocks.prepare.mock.calls[0][0]).toMatchObject({ visualCategory: 'fish', displayDurationMs: 5000 })
})
