import { describe, expect, it } from 'vitest'
import { calculateClockSample, chooseBestClockSample, serverEpochToPerformance } from './clock'
import { normalizeOmanPhone } from './phone'
import { firstLookScore, perfectSecondScore, resolveScoreCutoff } from './ranking'
import { generatePackedPositions } from './visuals'
import { participantWinner, tieBreakRole } from './public-result'
import { demoLobbyState } from './demo-state'

describe('registration and recovery primitives', () => {
  it('normalizes a local Oman number', () => expect(normalizeOmanPhone('9123 4567')).toBe('+96891234567'))
  it('normalizes an international Oman number', () => expect(normalizeOmanPhone('+968 9123 4567')).toBe('+96891234567'))
  it('rejects unsafe phone values', () => expect(normalizeOmanPhone('123')).toBeNull())
  it('does not accept an Oman prefix with extra digits', () => expect(normalizeOmanPhone('+968912345678')).toBeNull())
})

describe('clock synchronization', () => {
  it('uses midpoint RTT estimation', () => expect(calculateClockSample(1000, 1100, 1070)).toMatchObject({ offsetMs: 20, rttMs: 100 }))
  it('retains the lowest RTT sample', () => expect(chooseBestClockSample([{ offsetMs: 2, rttMs: 60, measuredAt: 1 }, { offsetMs: 7, rttMs: 18, measuredAt: 2 }])?.offsetMs).toBe(7))
  it('converts server epoch to performance schedule', () => expect(serverEpochToPerformance(11_000, 100, 10_000, 500)).toBe(1400))
})

describe('Perfect Second timing and ranking', () => {
  it('keeps signed early delta', () => expect(perfectSecondScore(5982, 6000)).toEqual({ signedDeltaMs: -18, absoluteErrorMs: 18 }))
  it('keeps signed late delta', () => expect(perfectSecondScore(6004, 6000)).toEqual({ signedDeltaMs: 4, absoluteErrorMs: 4 }))
  it('locks winners before a cutoff tie', () => expect(resolveScoreCutoff([{ participantId: 'a', score: 4 }, { participantId: 'b', score: 9 }, { participantId: 'c', score: 21 }, { participantId: 'd', score: 21 }, { participantId: 'e', score: 21 }], 3)).toEqual({ locked: [{ participantId: 'a', score: 4 }, { participantId: 'b', score: 9 }], tied: [{ participantId: 'c', score: 21 }, { participantId: 'd', score: 21 }, { participantId: 'e', score: 21 }], remainingSeats: 1 }))
  it('supports one winner', () => expect(resolveScoreCutoff([{ participantId: 'a', score: 1 }, { participantId: 'b', score: 2 }], 1).locked).toHaveLength(1))
  it('supports six winners', () => expect(resolveScoreCutoff(Array.from({ length: 8 }, (_, index) => ({ participantId: String(index), score: index })), 6).locked).toHaveLength(6))
})

describe('First Look', () => {
  it('scores absolute guess error', () => expect(firstLookScore(34, 36)).toBe(2))
  it('creates deterministic non-overlapping grid cells', () => {
    const first = generatePackedPositions(712, 36)
    expect(generatePackedPositions(712, 36)).toEqual(first)
    expect(new Set(first.map((point) => point.id)).size).toBe(36)
  })
})

describe('public result privacy and tie roles', () => {
  const state = { ...demoLobbyState, phase: 'tie_break' as const, tieEligiblePublicIds: ['mine'], winners: [{ participantPublicId: 'winner', displayName: 'مريم', score: 4 }] }
  it('detects a winner from the cached public list', () => expect(participantWinner(state, 'winner')?.displayName).toBe('مريم'))
  it('does not infer non-winners with an RPC', () => expect(participantWinner(state, 'other')).toBeNull())
  it('recognizes tie eligibility locally', () => expect(tieBreakRole(state, 'mine')).toBe('eligible'))
  it('keeps non-eligible participants as spectators', () => expect(tieBreakRole(state, 'other')).toBe('spectator'))
})
