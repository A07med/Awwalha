import { describe, expect, it } from 'vitest'
import { pollingDelay } from './use-public-state'

describe('participant polling', () => {
  it('jitters idle polling between 6 and 10 seconds', () => {
    expect(pollingDelay({ phase: 'lobby' }, 0, 0)).toBe(6000)
    expect(pollingDelay({ phase: 'lobby' }, 0, .999)).toBeGreaterThanOrEqual(9990)
  })
  it('uses faster jitter only while preparing', () => {
    expect(pollingDelay({ phase: 'preparing' }, 0, 0)).toBe(2000)
    expect(pollingDelay({ phase: 'preparing' }, 0, .999)).toBeLessThanOrEqual(4000)
  })
  it('slows after submission', () => expect(pollingDelay({ submitted: true }, 0, 0)).toBe(7000))
  it('uses 1.5–2.5 second jitter while waiting ready in Taif', () => {
    expect(pollingDelay({ taifReady: true }, 0, 0)).toBe(1500)
    expect(pollingDelay({ taifReady: true }, 0, .999)).toBeLessThanOrEqual(2500)
  })
  it('backs off exponentially with a cap', () => {
    expect(pollingDelay({ phase: 'lobby' }, 1, 0)).toBe(12000)
    expect(pollingDelay({ phase: 'lobby' }, 8, 0)).toBe(24000)
  })
})
