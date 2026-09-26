import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoTaifState } from '../lib/demo-state'
import { usePublicState, useTaifRevealRefresh } from './use-public-state'

const mocks = vi.hoisted(() => ({ fetchPublicState: vi.fn() }))
vi.mock('../lib/api', () => ({ fetchPublicState: mocks.fetchPublicState }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.stubEnv('VITE_APP_MODE', 'supabase')
  mocks.fetchPublicState.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('Taif reveal refresh', () => {
  it('retains a valid active screen on a failed poll without resubmitting or resetting', async () => {
    const valid = { ...structuredClone(demoTaifState), stateVersion: 100 }
    mocks.fetchPublicState.mockResolvedValueOnce(valid).mockRejectedValueOnce(new Error('temporary refresh failure'))
    const view = renderHook(() => usePublicState({ active: false }))
    await act(async () => { await view.result.current.refresh() })
    expect(view.result.current.state).toEqual(valid)
    await act(async () => { await view.result.current.refresh() })
    expect(view.result.current.state).toEqual(valid)
    expect(view.result.current.error).toBe('temporary refresh failure')
    expect(mocks.fetchPublicState).toHaveBeenCalledTimes(2)
  })

  it('does not regress to an older last-known-good snapshot and recovers on a newer revision', async () => {
    const valid = { ...structuredClone(demoTaifState), stateVersion: 100 }
    mocks.fetchPublicState.mockResolvedValueOnce(valid).mockResolvedValueOnce({ ...valid, stateVersion: 99, taifWinners: [] }).mockResolvedValueOnce({ ...valid, stateVersion: 101 })
    const view = renderHook(() => usePublicState({ active: false }))
    await act(async () => { await view.result.current.refresh() })
    await act(async () => { await view.result.current.refresh() })
    expect(view.result.current.state).toEqual(valid)
    await act(async () => { await view.result.current.refresh() })
    expect(view.result.current.state.stateVersion).toBe(101)
  })

  it('coalesces an in-flight request, refreshes once at reveal, and keeps one polling loop', async () => {
    const beforeReveal = { ...structuredClone(demoTaifState), taifWinners: [] }
    let finishInitial!: (value: typeof beforeReveal) => void
    mocks.fetchPublicState.mockImplementationOnce(() => new Promise((resolve) => { finishInitial = resolve }))
    mocks.fetchPublicState.mockResolvedValue(beforeReveal)

    const view = renderHook(() => {
      const publicState = usePublicState({ taifReady: true }, beforeReveal)
      useTaifRevealRefresh('demo-taif', publicState.refreshAtTaifReveal)
      return publicState
    })
    expect(mocks.fetchPublicState).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(mocks.fetchPublicState).toHaveBeenCalledTimes(1)
    await act(async () => { finishInitial(beforeReveal); await Promise.resolve() })
    expect(mocks.fetchPublicState).toHaveBeenCalledTimes(2)

    view.rerender()
    view.rerender()
    await act(async () => { await vi.advanceTimersByTimeAsync(1499) })
    expect(mocks.fetchPublicState).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(mocks.fetchPublicState).toHaveBeenCalledTimes(3)
    view.unmount()
  })
})
