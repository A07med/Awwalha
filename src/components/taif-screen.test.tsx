import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoTaifState } from '../lib/demo-state'
import type { ParticipantSession, PublicEventState } from '../types'
import { TaifScreen } from './taif-screen'

const mocks = vi.hoisted(() => ({ joinTaifRound: vi.fn() }))
vi.mock('../lib/api', () => ({ joinTaifRound: mocks.joinTaifRound }))

const session: ParticipantSession = { token: 'existing-session-token', participantPublicId: 'participant-me', displayName: 'مشارك' }

function state(phase: 'preparing' | 'active', winners: PublicEventState['taifWinners'] = []) {
  const value = structuredClone(demoTaifState)
  value.phase = phase
  value.taifWinners = winners
  value.round!.phase = phase
  return value
}

beforeEach(() => {
  sessionStorage.clear()
  vi.clearAllMocks()
  vi.stubEnv('VITE_APP_MODE', 'supabase')
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('Taif participant experience', () => {
  it('uses the existing session and sends exactly one ready request on a double tap', async () => {
    mocks.joinTaifRound.mockReturnValue(new Promise(() => {}))
    render(<TaifScreen state={state('preparing')} session={session} elapsedMs={-1000} onReadyChange={vi.fn()} />)
    const ready = screen.getByRole('button', { name: 'مستعد' })

    fireEvent.pointerDown(ready)
    fireEvent.pointerDown(ready)
    fireEvent.click(ready)

    await waitFor(() => expect(mocks.joinTaifRound).toHaveBeenCalledTimes(1))
    expect(mocks.joinTaifRound).toHaveBeenCalledWith(session.token, 'demo-taif')
    expect(screen.queryByRole('button', { name: 'مستعد' })).not.toBeInTheDocument()
  })

  it('contains no visible text during the active color animation', () => {
    const { container } = render(<TaifScreen state={state('active')} session={session} elapsedMs={1200} onReadyChange={vi.fn()} />)
    expect(container.textContent).toBe('')
    expect(container.querySelector('[data-taif-phase="active"]')).toBeInTheDocument()
  })

  it('does not expose a result before reveal time even if assignments arrive early', () => {
    const { container } = render(<TaifScreen state={state('active', demoTaifState.taifWinners)} session={session} elapsedMs={5900} onReadyChange={vi.fn()} />)
    expect(container.querySelector('[data-taif-phase="active"]')).toBeInTheDocument()
    expect(container.querySelector('[data-taif-color]')).not.toBeInTheDocument()
  })

  it('keeps animating past reveal time until all four assignments arrive, without briefly showing white', () => {
    const view = render(<TaifScreen state={state('active')} session={session} elapsedMs={7000} onReadyChange={vi.fn()} />)
    expect(view.container.querySelector('[data-taif-phase="active"]')).toBeInTheDocument()
    expect(view.container.querySelector('.taif-white')).not.toBeInTheDocument()
    view.rerender(<TaifScreen state={state('active', demoTaifState.taifWinners)} session={session} elapsedMs={7100} onReadyChange={vi.fn()} />)
    expect(view.container.querySelector('[data-taif-color="white"]')).toBeInTheDocument()
  })

  it.each([
    ['white', demoTaifState.taifWinners],
    ['green', [{ participantPublicId: session.participantPublicId, color: 'green' as const }, ...demoTaifState.taifWinners.slice(1)]],
    ['yellow', [{ participantPublicId: session.participantPublicId, color: 'yellow' as const }, ...demoTaifState.taifWinners.slice(1)]],
  ])('reveals a full-screen %s result without text', (color, winners) => {
    const { container } = render(<TaifScreen state={state('active', winners)} session={session} elapsedMs={7000} onReadyChange={vi.fn()} />)
    expect(container.textContent).toBe('')
    expect(container.querySelector(`[data-taif-color="${color}"]`)).toBeInTheDocument()
  })
})
