import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useScheduledClock } from './use-scheduled-clock'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('crosses the scheduled start without polling and never reuses another round clock', () => {
  let mono = 1000, epoch = Date.parse('2026-09-26T08:00:00Z')
  let frame: FrameRequestCallback = () => {}
  vi.spyOn(performance, 'now').mockImplementation(() => mono)
  vi.spyOn(Date, 'now').mockImplementation(() => epoch)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => { frame = fn; return 1 })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  const start = new Date(epoch + 500).toISOString()
  const view = renderHook(({ id, offset, startsAt }) => useScheduledClock(startsAt, offset, id), { initialProps: { id: 'a', offset: 0, startsAt: start } })
  expect(view.result.current.elapsedMs).toBe(-500)
  mono += 501; epoch += 501
  act(() => frame(mono))
  expect(view.result.current.elapsedMs).toBe(1)
  view.rerender({ id: 'a', offset: 1200, startsAt: start })
  expect(view.result.current.elapsedMs).toBe(1)
  mono += 6000; epoch += 6000
  act(() => frame(mono))
  expect(view.result.current.elapsedMs).toBe(6001)
  view.rerender({ id: 'b', offset: 0, startsAt: new Date(epoch + 15000).toISOString() })
  expect(view.result.current.elapsedMs).toBe(-15000)
})
