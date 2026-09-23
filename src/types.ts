export type GameType = 'perfect_second' | 'first_look' | 'taif'
export type TaifColor = 'green' | 'yellow'
export type RoundPhase = 'lobby' | 'preparing' | 'countdown' | 'active' | 'answering' | 'closed' | 'resolved' | 'tie_break' | 'revealed' | 'ended'

export interface PublicWinner {
  participantPublicId: string
  displayName: string
  score: number
  signedDeltaMs?: number
  guess?: number
}

export interface PublicRound {
  id: string
  gameType: GameType
  phase: RoundPhase
  startsAt: string | null
  closesAt: string | null
  targetMs?: number
  hideTimerAfterMs?: number
  displayDurationMs?: number
  revealAt?: string
  visualCategory?: 'seeds' | 'leaves' | 'fish' | 'bubbles' | 'drops'
  visualSeed?: number
  winnerTargetCount: number
  seatsAvailable: number
  parentRoundId?: string | null
}

export interface PublicEventState {
  stateVersion: number
  registrationOpen: boolean
  phase: RoundPhase
  currentGame: GameType | null
  round: PublicRound | null
  registeredCount: number
  submittedCount: number
  tieEligiblePublicIds: string[]
  winners: PublicWinner[]
  taifWinners: Array<{ participantPublicId: string; color: TaifColor }>
  revealedCorrectCount?: number
  serverPublishedAt: string
}

export interface ParticipantSession {
  token: string
  participantPublicId: string
  displayName: string
}

export interface RegisterResult extends ParticipantSession {
  recoveryCode: string
}

export interface PollOptions {
  active?: boolean
  timingCritical?: boolean
  submitted?: boolean
  phase?: RoundPhase
  operator?: boolean
  taifReady?: boolean
}

export interface ClockSample {
  offsetMs: number
  rttMs: number
  measuredAt: number
}
