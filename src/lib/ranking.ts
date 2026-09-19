export interface RankedAttempt { participantId: string; score: number }

export interface RankingResolution {
  locked: RankedAttempt[]
  tied: RankedAttempt[]
  remainingSeats: number
}

export function resolveScoreCutoff(attempts: RankedAttempt[], seats: number): RankingResolution {
  const ordered = [...attempts].sort((a, b) => a.score - b.score)
  if (ordered.length <= seats) return { locked: ordered, tied: [], remainingSeats: seats - ordered.length }
  const cutoff = ordered[seats - 1]?.score
  const before = ordered.filter((item) => item.score < cutoff)
  const atCutoff = ordered.filter((item) => item.score === cutoff)
  const remainingSeats = seats - before.length
  if (atCutoff.length <= remainingSeats) return { locked: ordered.slice(0, seats), tied: [], remainingSeats: 0 }
  return { locked: before, tied: atCutoff, remainingSeats }
}

export const perfectSecondScore = (elapsedMs: number, targetMs: number) => ({
  signedDeltaMs: Math.round(elapsedMs - targetMs),
  absoluteErrorMs: Math.abs(Math.round(elapsedMs - targetMs)),
})

export const firstLookScore = (guess: number, correctCount: number) => Math.abs(guess - correctCount)
