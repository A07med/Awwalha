import { describe, expect, it } from 'vitest'
import { demoPerfectState } from './demo-state'
import { scheduledInteractionActive } from './scheduled-activation'

describe('scheduled round safety', () => {
  const state = () => {
    const s = structuredClone(demoPerfectState)
    s.phase = s.round!.phase = 'preparing'
    s.round!.startsAt = '2026-09-26T08:00:00Z'
    s.round!.closesAt = '2026-09-26T08:00:14Z'
    return s
  }
  it('rejects missing and wrong clock round identity', () => {
    const s = state()
    expect(scheduledInteractionActive(s, null, 6000, 'p')).toBe(false)
    expect(scheduledInteractionActive(s, 'previous-round', 6000, 'p')).toBe(false)
    expect(scheduledInteractionActive({ ...s, round: null }, 'previous-round', 6000, 'p')).toBe(false)
  })
  it('rejects a future start, an expired previous round and nonfinite clocks', () => {
    const s = state()
    for (const elapsed of [-1, 14001, Infinity, NaN]) expect(scheduledInteractionActive(s, s.round!.id, elapsed, 'p')).toBe(false)
    expect(scheduledInteractionActive(s, s.round!.id, 0, 'p')).toBe(true)
  })
  it('rejects lifecycle termination and mismatched game', () => {
    const s = state()
    for (const phase of ['closed', 'resolved', 'revealed', 'ended', 'lobby', 'tie_break'] as const) {
      expect(scheduledInteractionActive({ ...s, phase }, s.round!.id, 1000, 'p')).toBe(false)
      expect(scheduledInteractionActive({ ...s, round: { ...s.round!, phase } }, s.round!.id, 1000, 'p')).toBe(false)
    }
    expect(scheduledInteractionActive({ ...s, currentGame: 'first_look' }, s.round!.id, 1000, 'p')).toBe(false)
  })
  it('requires canonical tie eligibility and valid timing/configuration', () => {
    const s = state()
    s.round!.parentRoundId = 'parent'
    expect(scheduledInteractionActive(s, s.round!.id, 1000, 'p')).toBe(false)
    s.tieEligiblePublicIds = ['p']
    expect(scheduledInteractionActive(s, s.round!.id, 1000, 'p')).toBe(true)
    s.round!.startsAt = 'invalid'
    expect(scheduledInteractionActive(s, s.round!.id, 1000, 'p')).toBe(false)
  })
  it('never manufactures Wahaj activation or winner information', () => {
    const s = state()
    s.currentGame = s.round!.gameType = 'taif'
    expect(scheduledInteractionActive(s, s.round!.id, 1000, 'p')).toBe(false)
    expect(s.taifWinners).toEqual([])
  })
})
