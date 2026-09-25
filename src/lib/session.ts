import type { ParticipantSession } from '../types'

const KEY = 'awwalha.participant.session.v1'
const PENDING_KEY = 'awwalha.participant.pending-registration.v1'

export interface PendingRegistration {
  displayName: string
  phone: string
  token: string
  recoveryCode: string
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function readPendingRegistration(): PendingRegistration | null {
  try {
    const value = localStorage.getItem(PENDING_KEY)
    if (!value) return null
    const pending = JSON.parse(value) as PendingRegistration
    if (!pending.displayName || !/^\+968[279][0-9]{7}$/.test(pending.phone)
      || !/^[a-f0-9]{64}$/.test(pending.token)
      || !/^[A-F0-9]{4}-[A-F0-9]{4}$/.test(pending.recoveryCode)) return null
    return pending
  } catch {
    return null
  }
}

export function prepareRegistration(displayName: string, phone: string): PendingRegistration {
  const existing = readPendingRegistration()
  if (existing?.phone === phone) return existing
  const recovery = randomHex(4).toUpperCase()
  const pending = {
    displayName: displayName.trim(),
    phone,
    token: randomHex(32),
    recoveryCode: `${recovery.slice(0, 4)}-${recovery.slice(4)}`,
  }
  // Persist before the request. If storage is unavailable, never create an
  // account whose only credentials could be lost with its HTTP response.
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
  return pending
}

export function clearPendingRegistration(token: string): void {
  if (readPendingRegistration()?.token === token) localStorage.removeItem(PENDING_KEY)
}

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
