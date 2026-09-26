import type { PublicEventState } from '../types'

// Derived interaction state only: the snapshot and RPC remain authoritative.
// elapsedMs must belong to this round's synchronized monotonic clock.
export function scheduledInteractionActive(state: PublicEventState, clockRoundId: string | null, elapsedMs: number, participantPublicId: string, privateTieEligible = false) {
  const round = state.round
  if (!round || round.id !== clockRoundId || state.currentGame !== round.gameType || round.gameType === 'taif') return false
  if (!['preparing', 'countdown', 'active', 'answering'].includes(round.phase) ||
      !['preparing', 'countdown', 'active', 'answering'].includes(state.phase)) return false
  if (!round.startsAt || !round.closesAt || !Number.isFinite(elapsedMs)) return false
  const start = Date.parse(round.startsAt)
  const close = Date.parse(round.closesAt)
  if (!Number.isFinite(start) || !Number.isFinite(close) || close <= start || elapsedMs < 0 || elapsedMs > close - start) return false
  if (round.parentRoundId && !(round.gameType === 'first_look' ? privateTieEligible : state.tieEligiblePublicIds.includes(participantPublicId))) return false
  if (round.gameType === 'perfect_second' && (!Number.isFinite(round.targetMs) || (round.targetMs ?? 0) <= 0)) return false
  if (round.gameType === 'first_look' && (!Number.isFinite(round.displayDurationMs) || (round.displayDurationMs ?? 0) <= 0)) return false
  return true
}
