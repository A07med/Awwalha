import type { PublicEventState, PublicRound, PublicWinner } from '../src/types'

const roundKeys = ['id', 'gameType', 'phase', 'startsAt', 'closesAt', 'revealAt', 'targetMs', 'hideTimerAfterMs', 'displayDurationMs', 'winnerTargetCount', 'seatsAvailable', 'parentRoundId'] as const
const winnerKeys = ['participantPublicId', 'displayName', 'score', 'signedDeltaMs', 'guess'] as const
const phases = ['lobby', 'preparing', 'countdown', 'active', 'answering', 'closed', 'resolved', 'tie_break', 'revealed', 'ended']
const games = ['perfect_second', 'first_look', 'taif']

function pick(value: object, keys: readonly string[]) {
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, (value as Record<string, unknown>)[key]]))
}

// Defense in depth: only this public RPC's explicit wire contract is cached.
// Never spread an upstream object into an audience response.
export function safePublicSnapshot(input: unknown, now = Date.now()): PublicEventState {
  const value = input as PublicEventState
  if (!value || !Number.isSafeInteger(value.stateVersion) || typeof value.registrationOpen !== 'boolean' || !phases.includes(value.phase) || (value.currentGame !== null && !games.includes(value.currentGame)) || !Number.isFinite(value.registeredCount) || !Number.isFinite(value.submittedCount) || !Array.isArray(value.winners) || !Array.isArray(value.taifWinners) || !Array.isArray(value.tieEligiblePublicIds) || !Number.isFinite(Date.parse(value.serverPublishedAt))) throw new Error('invalid public snapshot')
  const round = value.round ? pick(value.round, roundKeys) as unknown as PublicRound : null
  if (round && (typeof round.id !== 'string' || !games.includes(round.gameType) || !phases.includes(round.phase))) throw new Error('invalid public round')
  const taifRevealed = value.currentGame === 'taif' && round?.phase === 'active' && !!round.revealAt && Date.parse(round.revealAt) <= now
  const taifWinners = taifRevealed ? value.taifWinners.map((winner) => ({ participantPublicId: winner.participantPublicId, color: winner.color })) : []
  if (taifWinners.length && (taifWinners.length !== 4 || new Set(taifWinners.map((w) => w.participantPublicId)).size !== 4 || taifWinners.some((w) => typeof w.participantPublicId !== 'string') || taifWinners.filter((w) => w.color === 'green').length !== 2 || taifWinners.filter((w) => w.color === 'yellow').length !== 2)) throw new Error('invalid public color assignments')
  return {
    stateVersion: value.stateVersion,
    registrationOpen: value.registrationOpen,
    phase: value.phase,
    currentGame: value.currentGame,
    round,
    registeredCount: value.registeredCount,
    submittedCount: value.submittedCount,
    tieEligiblePublicIds: value.currentGame === 'first_look' ? [] : value.tieEligiblePublicIds.filter((id) => typeof id === 'string'),
    ...(Array.isArray(value.tieEligibilityTags) ? { tieEligibilityTags: value.tieEligibilityTags.filter(tag => typeof tag === 'string' && /^[a-f0-9]{64}$/.test(tag)) } : {}),
    winners: value.phase === 'revealed' && value.currentGame !== 'taif' ? value.winners.map((winner) => pick(winner, winnerKeys) as unknown as PublicWinner) : [],
    taifWinners,
    ...(value.phase === 'revealed' && value.currentGame === 'first_look' && Number.isFinite(value.revealedCorrectCount) ? { revealedCorrectCount: value.revealedCorrectCount } : {}),
    serverPublishedAt: value.serverPublishedAt,
  }
}
