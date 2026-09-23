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
