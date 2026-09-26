import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { WinnerGrid } from './winner-grid'
import type { PublicWinner } from '../types'
afterEach(cleanup)
const winner: PublicWinner = { participantPublicId: 'winner-1', displayName: 'أحمد العبري', score: 1, guess: 36 }
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
