// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import handler, { REFRESH_TIMEOUT_MS } from './state'
import { safePublicSnapshot } from './public-snapshot'
import { statePrerender, outputConfig } from '../scripts/vercel-output.mjs'

const lobby = { stateVersion: 8, registrationOpen: true, phase: 'lobby', currentGame: null, round: null, registeredCount: 500, submittedCount: 0, tieEligiblePublicIds: [], winners: [], taifWinners: [], serverPublishedAt: '2026-09-25T00:00:00Z' }
const assignments = ['green', 'green', 'yellow', 'yellow'].map((color, i) => ({ participantPublicId: `public-${i}`, color, displayName: 'PRIVATE', phone: 'PRIVATE', token: 'SECRET' }))
const round = { id: 'round', gameType: 'taif', phase: 'active', startsAt: '2026-09-25T00:00:00Z', closesAt: null, revealAt: '2026-09-25T00:00:10Z', winnerTargetCount: 4, seatsAvailable: 4 }

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

describe('safe shared public snapshot', () => {
  it('is a whitelist, not an upstream object spread', () => {
    const snapshot = safePublicSnapshot({ ...lobby, phone: 'PRIVATE', admin: 'SECRET', recoveryCode: 'SECRET', token: 'SECRET' })
    expect(snapshot).toEqual(lobby)
    expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE|SECRET/)
  })
  it.each(['preparing', 'countdown', 'active', 'answering', 'closed', 'resolved', 'tie_break', 'revealed', 'ended'])('preserves %s transitions and future schedules without inventing results', (phase) => {
    const value = { ...lobby, phase, currentGame: 'perfect_second', round: { ...round, gameType: 'perfect_second', phase, targetMs: 6000 }, tieEligiblePublicIds: ['eligible'] }
    expect(safePublicSnapshot(value).round).toEqual(value.round)
    expect(safePublicSnapshot(value).phase).toBe(phase)
    expect(safePublicSnapshot(value).tieEligiblePublicIds).toEqual(['eligible'])
  })
  it.each(['preparing', 'active', 'answering', 'tie_break', 'revealed'])('keeps First Look %s answers private until reveal', (phase) => {
    const snapshot = safePublicSnapshot({ ...lobby, phase, currentGame: 'first_look', round: { ...round, gameType: 'first_look', phase, correctCount: 47, visualSeed: 'PRIVATE' }, revealedCorrectCount: 47 })
    expect(snapshot.round).not.toHaveProperty('correctCount')
    expect(snapshot.round).not.toHaveProperty('visualSeed')
    expect(snapshot.revealedCorrectCount).toBe(phase === 'revealed' ? 47 : undefined)
  })
  it('Wahaj before reveal exposes zero identities even if upstream wrongly includes assignments', () => {
    expect(safePublicSnapshot({ ...lobby, currentGame: 'taif', phase: 'active', round, taifWinners: assignments }, Date.parse(round.revealAt) - 1).taifWinners).toEqual([])
  })
  it('Wahaj at/after reveal is exactly four public IDs: two green, two yellow, no names/phones', () => {
    const winners = safePublicSnapshot({ ...lobby, currentGame: 'taif', phase: 'active', round, taifWinners: assignments }, Date.parse(round.revealAt)).taifWinners
    expect(winners).toHaveLength(4)
    expect(winners.filter((w) => w.color === 'green')).toHaveLength(2)
    expect(winners.filter((w) => w.color === 'yellow')).toHaveLength(2)
    expect(winners.every((w) => Object.keys(w).sort().join(',') === 'color,participantPublicId')).toBe(true)
  })
  it('never invents missing reveal payload or a premature white result', () => {
    expect(safePublicSnapshot({ ...lobby, currentGame: 'taif', phase: 'active', round }).taifWinners).toEqual([])
  })
  it('rejects malformed/duplicate color assignments rather than caching corruption', () => {
    expect(() => safePublicSnapshot({ ...lobby, currentGame: 'taif', round, taifWinners: assignments.slice(0, 3) })).toThrow()
    expect(() => safePublicSnapshot({ ...lobby, currentGame: 'taif', round, taifWinners: Array(4).fill(assignments[0]) })).toThrow()
  })
  it('strips unrevealed regular winners and private fields on revealed winners', () => {
    const winner = { participantPublicId: 'id', displayName: 'PUBLIC NAME', score: 5, phone: 'PRIVATE', recoveryCode: 'SECRET' }
    expect(safePublicSnapshot({ ...lobby, winners: [winner] }).winners).toEqual([])
    expect(safePublicSnapshot({ ...lobby, currentGame: 'perfect_second', phase: 'revealed', winners: [winner] }).winners).toEqual([{ participantPublicId: 'id', displayName: 'PUBLIC NAME', score: 5 }])
  })
  it('does not cache invalid/synthetic data', () => {
    expect(() => safePublicSnapshot(null)).toThrow()
    expect(() => safePublicSnapshot({ ...lobby, stateVersion: undefined })).toThrow()
  })
})

describe('native shared ISR delivery contract', () => {
  it('uses a platform prerender key with collapsed regeneration, not instance-only memory', () => {
    expect(statePrerender).toEqual({ expiration: 1, allowQuery: [], passQuery: false })
    expect(statePrerender).not.toHaveProperty('bypassToken')
    expect(outputConfig.routes).toContainEqual({ handle: 'filesystem' })
  })
  it('does not let query strings create N refresh/cache keys', () => {
    expect(statePrerender.allowQuery).toEqual([])
    expect(statePrerender.passQuery).toBe(false)
  })
  it('publishes one safe canonical snapshot per regeneration with staging-safe telemetry', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://segymjevvgjywvqqjgyk.supabase.co')
    vi.stubEnv('SUPABASE_ANON_KEY', 'public-key')
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(lobby)))
    vi.stubGlobal('fetch', fetcher)
    const response = await handler()
    expect(await response.json()).toEqual(lobby)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(response.headers.get('x-awwalha-state-delivery')).toBe('isr-v1')
    expect(response.headers.has('set-cookie')).toBe(false)
  })
  it('failed regeneration cannot overwrite last-known-good with a dummy successful lobby', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://segymjevvgjywvqqjgyk.supabase.co')
    vi.stubEnv('SUPABASE_ANON_KEY', 'public-key')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('upstream timeout')))
    const response = await handler()
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'public_state_unavailable' })
  })
  it('bounds upstream waiting to 2s including body reading', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://segymjevvgjywvqqjgyk.supabase.co')
    vi.stubEnv('SUPABASE_ANON_KEY', 'public-key')
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))))
    const started = performance.now()
    expect((await handler()).status).toBe(503)
    expect(performance.now() - started).toBeLessThan(REFRESH_TIMEOUT_MS + 500)
  })
})
