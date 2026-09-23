import type { PublicEventState } from '../types'

export const demoPerfectState: PublicEventState = {
  stateVersion: 18,
  registrationOpen: true,
  phase: 'active',
  currentGame: 'perfect_second',
  round: {
    id: 'demo-perfect',
    gameType: 'perfect_second',
    phase: 'active',
    startsAt: new Date(Date.now() - 2350).toISOString(),
    closesAt: new Date(Date.now() + 8000).toISOString(),
    targetMs: 6000,
    hideTimerAfterMs: 1500,
    winnerTargetCount: 3,
    seatsAvailable: 3,
  },
  registeredCount: 428,
  submittedCount: 186,
  tieEligiblePublicIds: [],
  winners: [],
  taifWinners: [],
  serverPublishedAt: new Date().toISOString(),
}

export const demoFirstLookState: PublicEventState = {
  stateVersion: 26,
  registrationOpen: true,
  phase: 'active',
  currentGame: 'first_look',
  round: {
    id: 'demo-look',
    gameType: 'first_look',
    phase: 'active',
    startsAt: new Date(Date.now() - 450).toISOString(),
    closesAt: new Date(Date.now() + 9000).toISOString(),
    displayDurationMs: 1800,
    visualCategory: 'leaves',
    visualSeed: 90731,
    winnerTargetCount: 3,
    seatsAvailable: 3,
  },
  registeredCount: 428,
  submittedCount: 311,
  tieEligiblePublicIds: [],
  winners: [],
  taifWinners: [],
  serverPublishedAt: new Date().toISOString(),
}

export const demoLobbyState: PublicEventState = {
  stateVersion: 8,
  registrationOpen: true,
  phase: 'lobby',
  currentGame: null,
  round: null,
  registeredCount: 428,
  submittedCount: 0,
  tieEligiblePublicIds: [],
  winners: [],
  taifWinners: [],
  serverPublishedAt: new Date().toISOString(),
}

export const demoTaifState: PublicEventState = {
  ...demoLobbyState,
  stateVersion: 34,
  phase: 'active',
  currentGame: 'taif',
  round: {
    id: 'demo-taif',
    gameType: 'taif',
    phase: 'active',
    startsAt: new Date(Date.now() - 800).toISOString(),
    closesAt: new Date(Date.now() + 5200).toISOString(),
    revealAt: new Date(Date.now() + 5200).toISOString(),
    winnerTargetCount: 4,
    seatsAvailable: 4,
  },
  submittedCount: 483,
  taifWinners: [
    { participantPublicId: 'demo-green-1', color: 'green' },
    { participantPublicId: 'demo-green-2', color: 'green' },
    { participantPublicId: 'demo-yellow-1', color: 'yellow' },
    { participantPublicId: 'demo-yellow-2', color: 'yellow' },
  ],
}
