import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicEventState } from '../types'
import { demoFirstLookState, demoPerfectState } from '../lib/demo-state'
import { PlayPage } from './play'

const mocks = vi.hoisted(() => ({
  state: null as unknown as PublicEventState,
  elapsedMs: 6004,
  submitPerfectSecond: vi.fn(),
  submitFirstLook: vi.fn(),
}))

vi.mock('../hooks/use-public-state', () => ({
  usePublicState: () => ({ state: mocks.state, error: null, refresh: vi.fn(), refreshAtTaifReveal: vi.fn(), setState: vi.fn() }),
  useTaifRevealRefresh: vi.fn(),
}))
vi.mock('../hooks/use-clock-sync', () => ({ useClockSync: () => 0 }))
vi.mock('../hooks/use-scheduled-clock', () => ({ useScheduledClock: () => ({ elapsedMs: mocks.elapsedMs }) }))
vi.mock('../lib/session', () => ({
  readSession: () => ({ token: 'session-token', participantPublicId: 'participant-1', displayName: 'أحمد' }),
}))
vi.mock('../lib/api', () => ({
  submitPerfectSecond: mocks.submitPerfectSecond,
  submitFirstLook: mocks.submitFirstLook,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function renderPerfect() {
  mocks.state = structuredClone(demoPerfectState)
  mocks.elapsedMs = 6004
  return render(<PlayPage />)
}

function renderFirstLook() {
  mocks.state = structuredClone(demoFirstLookState)
  mocks.elapsedMs = 1800
  return render(<PlayPage />)
}

beforeEach(() => {
  sessionStorage.clear()
  vi.clearAllMocks()
  vi.stubEnv('VITE_APP_MODE', 'supabase')
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('Perfect Second submission UX', () => {
  it('shows immediate local feedback and disables STOP before the request resolves', async () => {
    const pending = deferred<{ elapsedMs: number; signedDeltaMs: number }>()
    mocks.submitPerfectSecond.mockReturnValue(pending.promise)
    renderPerfect()

    const stop = screen.getByRole('button', { name: 'STOP' })
    fireEvent.pointerDown(stop)

    expect(stop).toBeDisabled()
    expect(screen.getByText('تم تسجيل ضغطتك ⚡')).toBeInTheDocument()
    expect(screen.getByText('جاري تأكيدها...')).toBeInTheDocument()
    expect(screen.queryByText('+0.004s')).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.submitPerfectSecond).toHaveBeenCalledTimes(1))
  })

  it('creates only one API call on rapid repeated tapping', async () => {
    mocks.submitPerfectSecond.mockReturnValue(new Promise(() => {}))
    renderPerfect()

    const stop = screen.getByRole('button', { name: 'STOP' })
    fireEvent.pointerDown(stop)
    fireEvent.pointerDown(stop)
    fireEvent.click(stop)

    await waitFor(() => expect(mocks.submitPerfectSecond).toHaveBeenCalledTimes(1))
  })

  it('shows the server-confirmed signed result after success', async () => {
    mocks.submitPerfectSecond.mockResolvedValue({ elapsedMs: 6004, signedDeltaMs: 4 })
    renderPerfect()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'STOP' }))

    expect(await screen.findByText('تم التأكيد ✓')).toBeInTheDocument()
    expect(screen.getByText('+0.004s')).toBeInTheDocument()
  })

  it('retries with the exact same elapsed time, round, and metadata', async () => {
    mocks.submitPerfectSecond
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({ elapsedMs: 6004, signedDeltaMs: 4 })
    renderPerfect()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'STOP' }))

    fireEvent.click(await screen.findByRole('button', { name: 'إعادة المحاولة' }))
    await waitFor(() => expect(mocks.submitPerfectSecond).toHaveBeenCalledTimes(2))

    expect(mocks.submitPerfectSecond.mock.calls[1]).toEqual(mocks.submitPerfectSecond.mock.calls[0])
    expect(mocks.submitPerfectSecond.mock.calls[1][2]).toBe(6004)
    expect(await screen.findByText('تم التأكيد ✓')).toBeInTheDocument()
  })

  it('treats attempt_already_submitted as a safe confirmation', async () => {
    mocks.submitPerfectSecond.mockRejectedValue(new Error('attempt_already_submitted'))
    renderPerfect()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'STOP' }))

    expect(await screen.findByText('تم التأكيد ✓')).toBeInTheDocument()
    expect(screen.queryByText('تعذر تأكيد الإرسال')).not.toBeInTheDocument()
    expect(screen.getByText('+0.004s')).toBeInTheDocument()
  })

  it('preserves the captured attempt across quick navigation and retries it unchanged', async () => {
    const pending = deferred<{ elapsedMs: number; signedDeltaMs: number }>()
    mocks.submitPerfectSecond
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ elapsedMs: 6004, signedDeltaMs: 4 })
    const firstView = renderPerfect()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'STOP' }))
    await waitFor(() => expect(mocks.submitPerfectSecond).toHaveBeenCalledTimes(1))
    const capturedCall = mocks.submitPerfectSecond.mock.calls[0]

    firstView.unmount()
    renderPerfect()
    fireEvent.click(await screen.findByRole('button', { name: 'إعادة المحاولة' }))
    await waitFor(() => expect(mocks.submitPerfectSecond).toHaveBeenCalledTimes(2))

    expect(mocks.submitPerfectSecond.mock.calls[1]).toEqual(capturedCall)
    expect(await screen.findByText('تم التأكيد ✓')).toBeInTheDocument()
  })
})

describe('First Look submission UX', () => {
  it('immediately freezes the guess, disables repeat submission, and calls the API once', async () => {
    mocks.submitFirstLook.mockReturnValue(new Promise(() => {}))
    renderFirstLook()

    const input = screen.getByRole('spinbutton', { name: 'عدد العناصر' })
    const confirm = screen.getByRole('button', { name: 'تأكيد' })
    fireEvent.change(input, { target: { value: '36' } })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(input).toBeDisabled()
    expect(input).toHaveValue(36)
    expect(confirm).toBeDisabled()
    expect(screen.getByText('تم تسجيل إجابتك')).toBeInTheDocument()
    expect(screen.getByText('جاري التأكيد...')).toBeInTheDocument()
    await waitFor(() => expect(mocks.submitFirstLook).toHaveBeenCalledTimes(1))
  })

  it('shows confirmed state and preserves the submitted guess', async () => {
    mocks.submitFirstLook.mockResolvedValue({ guess: 41 })
    renderFirstLook()
    const input = screen.getByRole('spinbutton', { name: 'عدد العناصر' })
    fireEvent.change(input, { target: { value: '41' } })
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد' }))

    expect(await screen.findByText('تم التأكيد ✓')).toBeInTheDocument()
    expect(input).toBeDisabled()
    expect(input).toHaveValue(41)
    expect(screen.getByText('إجابتك: 41')).toBeInTheDocument()
  })

  it('retries with the exact same frozen guess and round', async () => {
    mocks.submitFirstLook
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({ guess: 39 })
    renderFirstLook()
    const input = screen.getByRole('spinbutton', { name: 'عدد العناصر' })
    fireEvent.change(input, { target: { value: '39' } })
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد' }))

    fireEvent.click(await screen.findByRole('button', { name: 'إعادة المحاولة' }))
    await waitFor(() => expect(mocks.submitFirstLook).toHaveBeenCalledTimes(2))

    expect(mocks.submitFirstLook.mock.calls[1]).toEqual(mocks.submitFirstLook.mock.calls[0])
    expect(mocks.submitFirstLook.mock.calls[1][2]).toBe(39)
    expect(input).toBeDisabled()
    expect(await screen.findByText('تم التأكيد ✓')).toBeInTheDocument()
  })
})

describe('scheduled activation without a fresh poll', () => {
  it.each(['perfect_second', 'first_look'] as const)('activates known %s at the synchronized start, without changing the snapshot', (game) => {
    mocks.state = structuredClone(game === 'perfect_second' ? demoPerfectState : demoFirstLookState)
    mocks.state.phase = 'preparing'
    mocks.state.round!.phase = 'preparing'
    mocks.elapsedMs = -1
    const view = render(<PlayPage />)
    const label = game === 'perfect_second' ? 'STOP' : 'تأكيد'
    expect(screen.getByRole('button', { name: label })).toBeDisabled()
    mocks.elapsedMs = 0
    view.rerender(<PlayPage />)
    expect(screen.getByRole('button', { name: label })).toBeEnabled()
    expect(mocks.state.round!.phase).toBe('preparing')
    mocks.elapsedMs = 2000
    view.rerender(<PlayPage />)
    expect(screen.getByRole('button', { name: label })).toBeEnabled()
    // Identical/slow preparing snapshots cannot roll local activation back.
    mocks.state = structuredClone(mocks.state)
    view.rerender(<PlayPage />)
    expect(screen.getByRole('button', { name: label })).toBeEnabled()
  })

  it('keeps one immutable attempt when STOP is activated from preparing', async () => {
    mocks.state = structuredClone(demoPerfectState)
    mocks.state.phase = mocks.state.round!.phase = 'preparing'
    mocks.elapsedMs = 6000
    mocks.submitPerfectSecond.mockReturnValue(new Promise(() => {}))
    render(<PlayPage />)
    const stop = screen.getByRole('button', { name: 'STOP' })
    fireEvent.pointerDown(stop)
    fireEvent.click(stop)
    await waitFor(() => expect(mocks.submitPerfectSecond).toHaveBeenCalledTimes(1))
    expect(mocks.submitPerfectSecond.mock.calls[0][2]).toBe(6000)
  })
})
