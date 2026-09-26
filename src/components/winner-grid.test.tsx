import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WinnerGrid } from './winner-grid'
import type { PublicWinner } from '../types'
afterEach(() => { cleanup(); vi.useRealTimers() })
const winner: PublicWinner = { participantPublicId: 'winner-1', displayName: 'أحمد العبري', score: 1, guess: 36 }
it('cycles all expanded winners in safe six-card pages without resetting on polling snapshots', () => {
  vi.useFakeTimers()
  const winners = Array.from({ length: 14 }, (_, i) => ({ ...winner, participantPublicId: 'p'+i, displayName: 'فائز '+i }))
  const view = render(<WinnerGrid winners={winners} game="first_look" />)
  act(() => vi.advanceTimersByTime(8000))
  expect(screen.getByText('فائز 6')).toBeInTheDocument()
  view.rerender(<WinnerGrid winners={structuredClone(winners)} game="first_look" />)
  act(() => vi.advanceTimersByTime(8000))
  expect(screen.getByText('فائز 13')).toBeInTheDocument()
  expect(screen.getAllByRole('article')).toHaveLength(2)
  act(() => vi.advanceTimersByTime(8000))
  expect(screen.getByText('فائز 0')).toBeInTheDocument()
})
it.each([[-123, 'قبل الوقت المستهدف بـ', '0.123'], [83, 'بعد الوقت المستهدف بـ', '0.083'], [0, 'مطابق تمامًا', '0.000']])('formats signed delta %s without changing it', (signedDeltaMs, label, number) => {
  const data = { ...winner, signedDeltaMs }
  const snapshot = structuredClone(data)
  render(<WinnerGrid winners={[data]} game="perfect_second" />)
  expect(screen.getByText(label)).toBeInTheDocument()
  expect(screen.getByText(number)).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/[+-]\d+\.\d+s/)
  expect(data).toEqual(snapshot)
})
it('separates First Look guess and difference without altering scoring', () => {
  render(<WinnerGrid winners={[winner]} game="first_look" />)
  expect(screen.getByText('إجابته')).toBeInTheDocument()
  expect(screen.getByText('الفارق')).toBeInTheDocument()
  expect(screen.getByText('36')).toBeInTheDocument()
  expect(screen.getByText('1')).toBeInTheDocument()
  expect(document.querySelectorAll('.reveal-answer > div')).toHaveLength(2)
})
it.each([1, 2, 3, 4, 5, 6])('preserves order and identity for %s winners', (count) => {
  const winners = Array.from({length: count}, (_,i) => ({...winner,participantPublicId: 'id-'+i, displayName: 'فائز '+i}))
  const snapshot = structuredClone(winners)
  render(<WinnerGrid winners={winners} game="perfect_second" />)
  expect(screen.getAllByRole('article')).toHaveLength(count)
  expect(screen.getAllByRole('heading').map(h=>h.textContent)).toEqual(winners.map(w=>w.displayName))
  expect(document.querySelectorAll('.first-place')).toHaveLength(1)
  expect(document.querySelector('.winner-grid')).toHaveClass('winners-'+count)
  expect(winners).toEqual(snapshot)
})
