import { beforeEach, describe, expect, it } from 'vitest'
import { clearSession, readSession, saveSession } from './session'

describe('participant sessions', () => {
  beforeEach(() => localStorage.clear())
  it('stores only the participant session on the device', () => {
    saveSession({ token: 'opaque', participantPublicId: 'public', displayName: 'سالم' })
    expect(readSession()).toEqual({ token: 'opaque', participantPublicId: 'public', displayName: 'سالم' })
  })
  it('clears a local session', () => { saveSession({ token: 'opaque', participantPublicId: 'public', displayName: 'سالم' }); clearSession(); expect(readSession()).toBeNull() })
  it('rejects malformed stored state', () => { localStorage.setItem('awwalha.participant.session.v1', '{}'); expect(readSession()).toBeNull() })
})
