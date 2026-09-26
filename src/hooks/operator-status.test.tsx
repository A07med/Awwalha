import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useOperatorRoundStatus } from './use-operator-round-status'
import { mergePublicSnapshot } from './use-public-state'
import { demoPerfectState } from '../lib/demo-state'

const status = vi.hoisted(() => vi.fn())
vi.mock('../lib/api', () => ({ adminRoundStatus: status, fetchPublicState: vi.fn() }))
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('VITE_APP_MODE', 'supabase'); status.mockReset(); Object.defineProperty(document, 'hidden', { configurable: true, value: false }) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); Object.defineProperty(document, 'hidden', { configurable: true, value: false }) })

it('accepts newer same-version counts without regressing confirmed phase/results', () => {
  const current = { ...structuredClone(demoPerfectState), serverPublishedAt: '2026-09-26T10:00:00Z', submittedCount: 0 }
  const next = { ...structuredClone(current), serverPublishedAt: '2026-09-26T10:00:01Z', submittedCount: 4, registeredCount: 42 }
  next.round!.phase = 'preparing'
  const merged = mergePublicSnapshot(current, next)
  expect(merged.submittedCount).toBe(4); expect(merged.registeredCount).toBe(42)
  expect(merged.round).toBe(current.round)
  expect(mergePublicSnapshot(merged, current)).toBe(merged)
  expect(mergePublicSnapshot(merged, { ...next, stateVersion: current.stateVersion - 1 })).toBe(merged)
})
it('updates counts 1/2/3/4 with one bounded request at a time', async () => {
  status.mockResolvedValueOnce({ submittedCount: 1 }).mockResolvedValueOnce({ submittedCount: 2 }).mockResolvedValueOnce({ submittedCount: 3 }).mockResolvedValueOnce({ submittedCount: 4 })
  const { result } = renderHook(() => useOperatorRoundStatus('round'))
  await act(async () => {})
  expect(result.current).toBe(1)
  for (const count of [2, 3, 4]) { await act(async () => { await vi.advanceTimersByTimeAsync(1500) }); expect(result.current).toBe(count) }
})
it('does not overlap pending requests, including repeated visibility events', async () => {
  let finish!: (value: { submittedCount: number }) => void
  status.mockReturnValue(new Promise((resolve) => { finish = resolve }))
  renderHook(() => useOperatorRoundStatus('round'))
  document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('visibilitychange'))
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  expect(status).toHaveBeenCalledTimes(1)
  await act(async () => { finish({ submittedCount: 1 }) })
})
it('pauses when hidden and resumes promptly; aborts and ignores removed round results', async () => {
  status.mockResolvedValue({ submittedCount: 2 })
  const { result, rerender } = renderHook(({ id }) => useOperatorRoundStatus(id), { initialProps: { id: 'a' } })
  await act(async () => {})
  Object.defineProperty(document, 'hidden', { configurable: true, value: true })
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  expect(status).toHaveBeenCalledTimes(1)
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  expect(status).toHaveBeenCalledTimes(2)
  let finish!: (value: { submittedCount: number }) => void
  status.mockReturnValueOnce(new Promise((resolve) => { finish = resolve })).mockResolvedValue({ submittedCount: 4 })
  rerender({ id: 'b' }); expect(result.current).toBeNull()
  const signal = status.mock.calls.at(-1)![1] as AbortSignal
  rerender({ id: 'c' }); expect(signal.aborted).toBe(true)
  await act(async () => { finish({ submittedCount: 99 }) })
  expect(result.current).toBe(4)
})
it('never polls on demo/audience usage without an operator round', async () => {
  renderHook(() => useOperatorRoundStatus(null))
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  expect(status).not.toHaveBeenCalled()
})
