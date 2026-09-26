import type { GameType, PublicEventState, PublicRound } from '../types'

// Real hydration starts without fabricated counts, private values or demo IDs.
export const stageLoadingState: PublicEventState = {
  stateVersion: 0, registrationOpen: false, phase: 'lobby', currentGame: null,
  round: null, registeredCount: 0, submittedCount: 0, winners: [],
  taifWinners: [], tieEligiblePublicIds: [], serverPublishedAt: '',
}
export const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
export function ownStageRound(state: PublicEventState, game: GameType, real: boolean) {
  const round = state.currentGame === game && state.round?.gameType === game ? state.round : null
  return round && (!real || isUuid(round.id)) ? round : null
}
export type StagePhase = 'loading' | 'idle' | 'preparing' | 'countdown' | 'active' | 'closed' | 'revealed'
export function stagePhase(hydrated: boolean, round: PublicRound | null, elapsedMs: number): StagePhase {
  if (!hydrated) return 'loading'
  if (!round || round.phase === 'lobby' || round.phase === 'ended') return 'idle'
  if (round.phase === 'revealed') return 'revealed'
  if (['closed', 'resolved', 'tie_break'].includes(round.phase)) return 'closed'
  if (round.gameType === 'taif' && round.phase === 'preparing') return 'preparing'
  if (!Number.isFinite(elapsedMs)) return 'preparing'
  if (elapsedMs < 0) return elapsedMs >= -16000 ? 'countdown' : 'preparing'
  if (round.closesAt && round.startsAt && elapsedMs >= Date.parse(round.closesAt) - Date.parse(round.startsAt)) return 'closed'
  return 'active'
}
