import { expect, it } from 'vitest'
import { demoPerfectState } from './demo-state'
import { adminErrorMessage, adminRoundActions, confirmedAdminState } from './admin-actions'

it('permits only close → resolve → reveal, with conditional tie-break', () => {
  const state = structuredClone(demoPerfectState)
  state.stateVersion = 100
  state.round!.closesAt = '2026-01-01T00:00:00Z'
  for (const phase of ['preparing', 'active'] as const) {
    state.round!.phase = phase; state.phase = phase
    expect(adminRoundActions(state)).toEqual({ close: true, resolve: false, tie: false, reveal: false })
  }
  state.round!.phase = state.phase = 'closed'
  expect(adminRoundActions(state)).toEqual({ close: false, resolve: true, tie: false, reveal: false })
  state.round!.phase = state.phase = 'resolved'
  expect(adminRoundActions(state)).toEqual({ close: false, resolve: false, tie: false, reveal: true })
  state.phase = 'tie_break'; state.tieEligiblePublicIds = ['a', 'b']
  expect(adminRoundActions(state)).toEqual({ close: false, resolve: false, tie: true, reveal: false })
  state.tieEligiblePublicIds = []
  expect(adminRoundActions(state).tie).toBe(true)
  state.round!.phase = state.phase = 'revealed'
  expect(Object.values(adminRoundActions(state)).every((v) => !v)).toBe(true)
})
it('requires an explicit Close after the scheduled deadline, and waits for submission grace', () => {
  const state = structuredClone(demoPerfectState)
  state.round!.phase = state.phase = 'closed'; state.stateVersion = 102
  state.round!.closesAt = '2026-01-01T00:00:00Z'
  expect(adminRoundActions(state).close).toBe(true)
  expect(adminRoundActions(state).resolve).toBe(false)
  expect(adminRoundActions(state, true).resolve).toBe(true)
  state.round!.closesAt = new Date().toISOString()
  expect(adminRoundActions(state, true).resolve).toBe(false)
})
it.each(['round_not_closeable', 'round_not_closed', 'parent_not_resolved', 'no_tie_break_needed', 'round_not_resolved', 'winner_count_incomplete', 'submission_grace_active', 'unknown_sql_error'])('maps %s to useful Arabic without leaking internal errors', (message) => {
  const text = adminErrorMessage(new Error(message))
  expect(text).toMatch(/[\u0600-\u06ff]/)
  expect(text).not.toContain(message)
})
it('does not regress successful admin transitions to intermediate ISR snapshots', () => {
  const state = structuredClone(demoPerfectState)
  state.round!.phase = state.phase = 'closed'; state.stateVersion = 104
  const confirmed = { roundId: state.round!.id, phase: 'resolved' as const, publicPhase: 'resolved' as const, closesAt: state.round!.closesAt }
  const effective = confirmedAdminState(state, confirmed)
  expect(adminRoundActions(effective).resolve).toBe(false)
  expect(adminRoundActions(effective).reveal).toBe(true)
  expect(confirmedAdminState(state, { ...confirmed, roundId: 'different' })).toBe(state)
  state.round!.phase = state.phase = 'revealed'
  expect(confirmedAdminState(state, confirmed)).toBe(state)
})
