import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { clearSession, saveSession } from '../lib/session'
import { LandingPage } from './landing'

afterEach(() => { cleanup(); clearSession() })

describe('Awwalha landing page', () => {
  it('introduces the three games and sends a new guest to join', () => {
    render(<MemoryRouter><LandingPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'الثانية المثالية' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'أول نظرة' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'طَيْف' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /انضم إلى التجربة/ })).toHaveAttribute('href', '/join')
  })

  it('offers a returning participant a path back to play', () => {
    saveSession({ token: 'demo-token', participantPublicId: 'demo-id', displayName: 'أحمد' })
    render(<MemoryRouter><LandingPage /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /تابع اللعب/ })).toHaveAttribute('href', '/play')
  })
})
