import { StrictMode } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StagePerfectPage } from './stage-perfect'
import { StageFirstLookPage } from './stage-first-look'
import { StageTaifPage } from './stage-taif'
import { demoFirstLookState, demoPerfectState, demoTaifState } from '../lib/demo-state'
import { stageLoadingState } from '../lib/stage-state'
import type { PublicEventState } from '../types'

const mocks = vi.hoisted(() => ({ state: null as PublicEventState | null, hydrated: true, elapsedMs: 400, detail: vi.fn(), clock: vi.fn(), initial: null as PublicEventState | null }))
vi.mock('../hooks/use-public-state', () => ({
  usePublicState: (_: unknown, initial: PublicEventState) => { mocks.initial = initial; return { state: mocks.state ?? initial, hydrated: mocks.hydrated, refreshAtTaifReveal: vi.fn() } },
  useTaifRevealRefresh: vi.fn(),
}))
vi.mock('../hooks/use-clock-sync', () => ({ useClockSync: () => 0 }))
vi.mock('../hooks/use-scheduled-clock', () => ({ useScheduledClock: (...args: unknown[]) => { mocks.clock(...args); return { elapsedMs: mocks.elapsedMs } } }))
vi.mock('../lib/api', () => ({ adminRoundDetail: (...args: unknown[]) => mocks.detail(...args) }))

const id = '33333333-3333-4333-8333-333333333333'
const data = { correctCount: 36, visualSeed: 90731, visualCategory: 'leaves', displayDurationMs: 1800 }
const real = (state: PublicEventState) => ({ ...structuredClone(state), round: state.round ? { ...state.round, id, startsAt: '2026-09-26T10:00:00Z', closesAt: '2026-09-26T10:00:12Z', revealAt: '2026-09-26T10:00:06Z' } : null })
beforeEach(() => { vi.stubEnv('VITE_APP_MODE', 'supabase'); mocks.state = null; mocks.hydrated = true; mocks.elapsedMs = 400; mocks.clock.mockClear(); mocks.detail.mockReset().mockResolvedValue(data) })
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

describe('strict projector game ownership and hydration', () => {
  it.each([
    [StagePerfectPage, demoFirstLookState], [StagePerfectPage, demoTaifState],
    [StageFirstLookPage, demoPerfectState], [StageFirstLookPage, demoTaifState],
    [StageTaifPage, demoPerfectState], [StageTaifPage, demoFirstLookState],
  ])('ignores unrelated rounds', (Page, state) => {
    mocks.state = real(state); mocks.elapsedMs = -604071000
    const { container } = render(<Page />)
    expect(container.querySelector('[data-stage-phase="idle"]')).toBeInTheDocument()
    expect(screen.getByText('بانتظار بدء الجولة')).toBeInTheDocument()
    expect(container.querySelector('.projector-timer, .projector-countdown, .visual-field')).toBeNull()
    expect(mocks.clock).toHaveBeenCalledWith(undefined, 0, undefined)
    expect(mocks.detail).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('604071')
  })
  it.each([StagePerfectPage, StageFirstLookPage, StageTaifPage])('loads without fabricated real-mode data', (Page) => {
    mocks.hydrated = false
    const { container } = render(<Page />)
    expect(mocks.initial).toEqual(stageLoadingState)
    expect(container.querySelector('[data-stage-phase="loading"]')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/428|186|311|demo-/)
    expect(container.querySelector('.projector-rail, .projector-countdown, .projector-timer')).toBeNull()
    expect(mocks.detail).not.toHaveBeenCalled()
  })
  it.each(['demo-look', 'demo-perfect', 'demo-taif', 'invalid'])('never sends invalid UUID %s', (badId) => {
    mocks.state = real(demoFirstLookState); mocks.state.round!.id = badId
    render(<StageFirstLookPage />)
    expect(mocks.detail).not.toHaveBeenCalled()
  })
  it('does not request private data before real hydration', () => {
    mocks.state = real(demoFirstLookState); mocks.hydrated = false
    render(<StageFirstLookPage />)
    expect(mocks.detail).not.toHaveBeenCalled()
  })
  it('requires matching round gameType too', () => {
    mocks.state = real(demoFirstLookState); mocks.state.round!.gameType = 'taif'
    render(<StageFirstLookPage />)
    expect(mocks.detail).not.toHaveBeenCalled()
  })
  it.each([StagePerfectPage, StageFirstLookPage])('bounds its own countdown', (Page) => {
    mocks.state = real(Page === StagePerfectPage ? demoPerfectState : demoFirstLookState); mocks.elapsedMs = -604108000
    const { container } = render(<Page />)
    expect(container.querySelector('[data-stage-phase="preparing"]')).toBeInTheDocument()
    expect(container.querySelector('.projector-countdown')).toBeNull()
    expect(container.textContent).not.toContain('604108')
  })
  it('hides Perfect timer after the scheduled threshold', () => {
    mocks.state = real(demoPerfectState); mocks.elapsedMs = 2000
    render(<StagePerfectPage />)
    expect(screen.getByText('?.???')).toBeInTheDocument()
    expect(screen.getByText('6.000')).toBeInTheDocument()
  })
  it.each(['closed', 'resolved', 'tie_break'] as const)('does not retain a timer in %s', (phase) => {
    mocks.state = real(demoPerfectState); mocks.state.round!.phase = phase
    const { container } = render(<StagePerfectPage />)
    expect(screen.getByText('جاري حساب النتيجة')).toBeInTheDocument()
    expect(container.querySelector('.projector-timer')).toBeNull()
  })
  it('does not leak Wahaj results before reveal even if payload arrives early', () => {
    mocks.state = real(demoTaifState); mocks.elapsedMs = 1000
    const { container } = render(<StageTaifPage />)
    expect(container.querySelector('.taif-stage-active')).toBeInTheDocument()
    expect(container.textContent).toBe('')
    expect(container.innerHTML).not.toMatch(/demo-green|demo-yellow|لدينا/)
  })
  it('uses readiness only on a Wahaj preparing round, not its placeholder countdown', () => {
    mocks.state = real(demoTaifState); mocks.state.round!.phase = 'preparing'; mocks.elapsedMs = -604000000
    render(<StageTaifPage />)
    expect(screen.getByText('483')).toBeInTheDocument()
    expect(screen.getByText('استعد للّون')).toBeInTheDocument()
    expect(document.querySelector('.projector-countdown')).toBeNull()
  })
})

describe('operator-private First Look details', () => {
  it('requests exactly once for a hydrated UUID, including StrictMode replay and polls', async () => {
    mocks.state = real(demoFirstLookState)
    const { rerender, container } = render(<StrictMode><StageFirstLookPage /></StrictMode>)
    await waitFor(() => expect(container.querySelectorAll('.visual-item')).toHaveLength(36))
    rerender(<StrictMode><StageFirstLookPage /></StrictMode>)
    expect(mocks.detail).toHaveBeenCalledExactlyOnceWith(id)
    expect(container.textContent).not.toContain('36')
    mocks.elapsedMs = 2000
    rerender(<StrictMode><StageFirstLookPage /></StrictMode>)
    expect(container.querySelector('.visual-field')).toBeNull()
    expect(screen.getByText('كم عنصرًا رأيت؟')).toBeInTheDocument()
  })
  it('handles detail rejection without retries or an unhandled rejection', async () => {
    mocks.state = real(demoFirstLookState); mocks.detail.mockRejectedValue(new Error('admin_required'))
    const { rerender } = render(<StageFirstLookPage />)
    await screen.findByText('تعذر تحميل عرض الجولة')
    rerender(<StageFirstLookPage />)
    expect(mocks.detail).toHaveBeenCalledTimes(1)
  })
  it('clears old detail immediately and ignores late responses on round change', async () => {
    mocks.state = real(demoFirstLookState)
    const { rerender, container } = render(<StageFirstLookPage />)
    await waitFor(() => expect(container.querySelectorAll('.visual-item')).toHaveLength(36))
    let resolve: (value: typeof data) => void = () => {}
    mocks.detail.mockImplementation(() => new Promise((r) => { resolve = r }))
    mocks.state.round!.id = '44444444-4444-4444-8444-444444444444'
    rerender(<StageFirstLookPage />)
    expect(container.querySelector('.visual-field')).toBeNull()
    mocks.state = real(demoTaifState)
    rerender(<StageFirstLookPage />)
    resolve(data)
    await waitFor(() => expect(container.querySelector('[data-stage-phase="idle"]')).toBeInTheDocument())
    expect(container.querySelector('.visual-field')).toBeNull()
  })
})
