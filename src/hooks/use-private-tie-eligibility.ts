import { useEffect, useState } from 'react'
import type { ParticipantSession, PublicEventState } from '../types'

export async function sessionEligibilityTag(token: string, roundId: string) {
  const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('')
  return digest(await digest(token) + ':' + roundId)
}

// A local capability comparison only. No audience Supabase reads or new
// polling: round-scoped proofs arrive through the existing shared snapshot.
export function usePrivateTieEligibility(state: PublicEventState, session: ParticipantSession) {
  const roundId = state.round?.gameType === 'first_look' && state.round.parentRoundId ? state.round.id : null
  const [proof, setProof] = useState<{ roundId: string; tag: string } | null>(null)
  useEffect(() => {
    let stopped = false
    if (roundId) void sessionEligibilityTag(session.token, roundId).then(tag => { if (!stopped) setProof({ roundId, tag }) }).catch(() => { /* Fail closed. */ })
    return () => { stopped = true }
  }, [roundId, session.token])
  return !!roundId && proof?.roundId === roundId && !!state.tieEligibilityTags?.includes(proof.tag)
}
