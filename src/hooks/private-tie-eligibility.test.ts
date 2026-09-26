// @vitest-environment node
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { sessionEligibilityTag } from './use-private-tie-eligibility'
import { safePublicSnapshot } from '../../api/public-snapshot'
import { demoLobbyState } from '../lib/demo-state'
import { scheduledInteractionActive } from '../lib/scheduled-activation'

it('matches the SQL round-scoped proof without exposing public identity or token hash', async () => {
  const token = 'a'.repeat(64), roundId = 'c0000000-0000-0000-0000-000000000001'
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  const tag = await sessionEligibilityTag(token, roundId)
  expect(tag).toBe(hash(hash(token) + ':' + roundId))
  expect(tag).not.toBe(hash(token))
  expect(await sessionEligibilityTag(token, 'another-round')).not.toBe(tag)
  expect(await sessionEligibilityTag('b'.repeat(64), roundId)).not.toBe(tag)
})
it('strips First Look identity leaks and retains only valid private proofs in cached state', () => {
  const state = { ...demoLobbyState, currentGame: 'first_look' as const, phase: 'tie_break' as const, tieEligiblePublicIds: ['private-person'], tieEligibilityTags: ['a'.repeat(64), 'invalid'], winners: [{ participantPublicId: 'locked', displayName: 'اسم', score: 0, guess: 36 }], revealedCorrectCount: 36 }
  const value = safePublicSnapshot(state)
  expect(value.tieEligiblePublicIds).toEqual([])
  expect(value.tieEligibilityTags).toEqual(['a'.repeat(64)])
  expect(value.winners).toEqual([])
  expect(value.revealedCorrectCount).toBeUndefined()
  expect(JSON.stringify(value)).not.toMatch(/private-person|locked|اسم|guess/)
})
it('preserves Perfect Second public eligibility unchanged', () => {
  expect(safePublicSnapshot({ ...demoLobbyState, currentGame: 'perfect_second', tieEligiblePublicIds: ['p'] }).tieEligiblePublicIds).toEqual(['p'])
})
it('only the own private proof permits local First Look tie interaction', () => {
  const state = { ...demoLobbyState, currentGame: 'first_look' as const, phase: 'active' as const, round: { id: 'child', gameType: 'first_look' as const, phase: 'active' as const, parentRoundId: 'parent', startsAt: '2026-09-26T00:00:00Z', closesAt: '2026-09-26T00:00:16Z', displayDurationMs: 1800, winnerTargetCount: 3, seatsAvailable: 1 }, tieEligiblePublicIds: [] }
  expect(scheduledInteractionActive(state, 'child', 3000, 'p', false)).toBe(false)
  expect(scheduledInteractionActive(state, 'child', 3000, 'p', true)).toBe(true)
})
