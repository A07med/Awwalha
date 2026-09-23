import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoTaifState } from '../lib/demo-state'
import { StageTaifPage } from './stage-taif'

const mocks = vi.hoisted(() => ({ elapsedMs: 7000 }))
vi.mock('../hooks/use-public-state', () => ({ usePublicState: () => ({ state: structuredClone(demoTaifState) }) }))
vi.mock('../hooks/use-clock-sync', () => ({ useClockSync: () => 0 }))
vi.mock('../hooks/use-scheduled-clock', () => ({ useScheduledClock: () => ({ elapsedMs: mocks.elapsedMs }) }))

afterEach(cleanup)

describe('Taif stage', () => {
  it('shows only the final four-winner message and no identities', () => {
    render(<StageTaifPage />)
    expect(screen.getByRole('heading', { name: 'لدينا ٤ فائزين' })).toBeInTheDocument()
    expect(document.body.textContent).toBe('لدينا ٤ فائزين')
    expect(document.body.textContent).not.toContain('مشارك')
  })
})
