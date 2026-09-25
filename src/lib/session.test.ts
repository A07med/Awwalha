import { beforeEach, describe, expect, it } from 'vitest'
import { clearPendingRegistration, clearSession, prepareRegistration, readPendingRegistration, readSession, saveSession } from './session'

describe('participant sessions', () => {
  beforeEach(() => localStorage.clear())
  it('stores only the participant session on the device', () => {
    saveSession({ token: 'opaque', participantPublicId: 'public', displayName: 'سالم' })
    expect(readSession()).toEqual({ token: 'opaque', participantPublicId: 'public', displayName: 'سالم' })
  })
  it('clears a local session', () => { saveSession({ token: 'opaque', participantPublicId: 'public', displayName: 'سالم' }); clearSession(); expect(readSession()).toBeNull() })
  it('rejects malformed stored state', () => { localStorage.setItem('awwalha.participant.session.v1', '{}'); expect(readSession()).toBeNull() })
  it('retains the same strong credentials after a lost registration response or reload', () => {
    const first = prepareRegistration('أحمد', '+96891234568')
    expect(first.token).toMatch(/^[a-f0-9]{64}$/)
    expect(first.recoveryCode).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}$/)
    expect(readPendingRegistration()).toEqual(first)
    expect(prepareRegistration('أحمد', '+96891234568')).toEqual(first)
  })
  it('only clears the matching pending registration after its session is saved', () => {
    const first = prepareRegistration('أحمد', '+96891234568')
    clearPendingRegistration('wrong')
    expect(readPendingRegistration()).toEqual(first)
    saveSession({ token: first.token, participantPublicId: 'public', displayName: 'أحمد' })
    clearPendingRegistration(first.token)
    expect(readPendingRegistration()).toBeNull()
    expect(readSession()?.token).toBe(first.token)
  })
  it('creates new credentials for a different phone', () => {
    const first = prepareRegistration('أحمد', '+96891234568')
    const second = prepareRegistration('سالم', '+96891234569')
    expect(second.token).not.toBe(first.token)
    expect(readPendingRegistration()).toEqual(second)
  })
})
