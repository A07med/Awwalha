import type { PublicEventState } from '../types'

export function participantWinner(state: PublicEventState, participantPublicId: string) {
  return state.winners.find((winner) => winner.participantPublicId === participantPublicId) ?? null
}

export function tieBreakRole(state: PublicEventState, participantPublicId: string): 'eligible' | 'spectator' | 'none' {
  if (state.phase !== 'tie_break') return 'none'
  return state.tieEligiblePublicIds.includes(participantPublicId) ? 'eligible' : 'spectator'
}
