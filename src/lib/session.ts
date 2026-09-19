import type { ParticipantSession } from '../types'

const KEY = 'awwalha.participant.session.v1'

export function readSession(): ParticipantSession | null {
  try {
    const value = localStorage.getItem(KEY)
    if (!value) return null
    const parsed = JSON.parse(value) as ParticipantSession
    if (!parsed.token || !parsed.participantPublicId || !parsed.displayName) return null
    return parsed
  } catch {
    return null
  }
}

export function saveSession(session: ParticipantSession) {
  localStorage.setItem(KEY, JSON.stringify(session))
}

export function clearSession() {
  localStorage.removeItem(KEY)
}
