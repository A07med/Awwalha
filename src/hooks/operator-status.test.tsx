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
  expect(result.current.submittedCount).toBe(1)
  for (const count of [2, 3, 4]) { await act(async () => { await vi.advanceTimersByTimeAsync(1500) }); expect(result.current.submittedCount).toBe(count) }
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
  rerender({ id: 'b' }); expect(result.current.submittedCount).toBeNull()
  const signal = status.mock.calls.at(-1)![1] as AbortSignal
  rerender({ id: 'c' }); expect(signal.aborted).toBe(true)
  await act(async () => { finish({ submittedCount: 99 }) })
  expect(result.current.submittedCount).toBe(4)
})
it.each([
  [{ message: 'admin_required', status: 400, code: '42501' }, 'authorization'],
  [{ message: 'JWT expired', status: 401, code: 'PGRST301' }, 'reauthenticate'],
  [{ message: 'signature mismatch', status: 404, code: 'PGRST202' }, 'unavailable'],
] as const)('stops deterministic failure %s, including visibility changes', async (error, expected) => {
  status.mockRejectedValue(error)
  const { result } = renderHook(() => useOperatorRoundStatus('round'))
  await act(async () => {})
  expect(result.current.error).toBe(expected)
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(60000) })
  expect(status).toHaveBeenCalledTimes(1)
})
it('stops a stale round, refreshes public state once, and only resumes for a new ID', async () => {
  status.mockRejectedValueOnce({ message: 'invalid_round', status: 400, code: '22023' }).mockResolvedValue({ submittedCount: 2 })
  const refresh = vi.fn().mockResolvedValue(undefined)
  const { result, rerender } = renderHook(({ id }) => useOperatorRoundStatus(id, refresh), { initialProps: { id: 'stale' } })
  await act(async () => {})
  expect(result.current.error).toBe('invalid_round'); expect(refresh).toHaveBeenCalledTimes(1)
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(60000) })
  expect(status).toHaveBeenCalledTimes(1)
  rerender({ id: 'new' }); await act(async () => {})
  expect(result.current.submittedCount).toBe(2); expect(result.current.error).toBeNull()
  rerender({ id: 'stale' }); await act(async () => {})
  expect(result.current.error).toBe('invalid_round'); expect(status).toHaveBeenCalledTimes(2)
})
it('retries transient failures with backoff but stops after five consecutive failures', async () => {
  status.mockRejectedValue({ message: 'upstream failure', status: 503 })
  const { result } = renderHook(() => useOperatorRoundStatus('round'))
  await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
  expect(status).toHaveBeenCalledTimes(5)
  expect(result.current.error).toBe('unavailable')
})
it('never polls on demo/audience usage without an operator round', async () => {
  renderHook(() => useOperatorRoundStatus(null))
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  expect(status).not.toHaveBeenCalled()
})
