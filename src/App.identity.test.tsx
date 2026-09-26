import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { demoLobbyState } from './lib/demo-state'
import { saveSession, prepareRegistration } from './lib/session'
const mocks = vi.hoisted(() => ({ verify: vi.fn(), register: vi.fn(), recover: vi.fn(), signIn: vi.fn(), state: null as unknown as typeof demoLobbyState }))
vi.mock('./lib/api', () => ({ registerParticipant: mocks.register, recoverParticipant: mocks.recover, verifyAdminAccess: mocks.verify,
  supabase: { auth: { signInWithPassword: mocks.signIn, onAuthStateChange: () => ({data:{subscription:{unsubscribe(){}}}}) } } }))
vi.mock('./hooks/use-public-state', () => ({ usePublicState: () => ({ state: mocks.state, hydrated: true }) }))
vi.mock('./pages/admin', () => ({ AdminPage: () => <h1>PRIVATE ADMIN</h1> }))
vi.mock('./pages/play', () => ({ PlayPage: () => <h1>PARTICIPANT PLAY</h1> }))
vi.mock('./pages/stage-perfect', () => ({ StagePerfectPage: () => <h1>STAGE</h1> }))
vi.mock('./pages/stage-first-look', () => ({ StageFirstLookPage: () => <h1>STAGE</h1> }))
vi.mock('./pages/stage-taif', () => ({ StageTaifPage: () => <h1>STAGE</h1> }))
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); vi.stubEnv('VITE_APP_MODE','supabase'); mocks.state = structuredClone(demoLobbyState); mocks.verify.mockResolvedValue('allowed'); mocks.signIn.mockResolvedValue({error:null}) })
afterEach(() => { cleanup(); vi.unstubAllEnvs() })
function view(path: string) { return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>) }
it.each(['none','participant','already_registered','admin','both'])('admin login is independent of %s participant context', async context => {
  if (context === 'participant' || context === 'both') saveSession({token:'participant-token',participantPublicId:'p',displayName:'مشارك'})
  if (context === 'already_registered') { prepareRegistration('مسجل','+96891234567'); mocks.register.mockRejectedValue(new Error('already_registered')) }
  view('/admin/login')
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'owner@example.test'}})
  fireEvent.change(document.querySelector('input[type=password]')!,{target:{value:'test-password'}})
  fireEvent.click(screen.getByRole('button',{name:'دخول'}))
  expect(await screen.findByText('PRIVATE ADMIN')).toBeInTheDocument()
  expect(mocks.register).not.toHaveBeenCalled(); expect(mocks.recover).not.toHaveBeenCalled()
})
it.each(['/admin','/stage/perfect-second','/stage/first-look','/stage/taif'])('%s allows both identities without participant RPCs', async path => {
  saveSession({token:'participant-token',participantPublicId:'p',displayName:'مشارك'}); view(path)
  expect(await screen.findByText(path === '/admin' ? 'PRIVATE ADMIN' : 'STAGE')).toBeInTheDocument()
  expect(mocks.register).not.toHaveBeenCalled(); expect(mocks.recover).not.toHaveBeenCalled()
})
it('missing admin identity redirects regardless of participant identity',async () => {
  saveSession({token:'participant-token',participantPublicId:'p',displayName:'مشارك'}); mocks.verify.mockResolvedValue('unauthenticated'); view('/admin')
  expect(await screen.findByText('دخول الفريق')).toBeInTheDocument(); expect(mocks.register).not.toHaveBeenCalled()
})
it('authenticated nonadmin with participant identity is still denied',async () => {
  saveSession({token:'participant-token',participantPublicId:'p',displayName:'مشارك'}); mocks.verify.mockResolvedValue('forbidden'); view('/admin')
  expect(await screen.findByRole('alert')).toHaveTextContent('غير مخوّل'); expect(mocks.register).not.toHaveBeenCalled()
})
it('closed join hides registration but retains recovery and existing play link', () => {
  mocks.state.registrationOpen=false; saveSession({token:'p',participantPublicId:'p',displayName:'مشارك'}); view('/join')
  expect(screen.getByText('التسجيل مغلق حاليًا')).toBeInTheDocument(); expect(screen.queryByRole('button',{name:/انضم الآن/})).not.toBeInTheDocument()
  expect(screen.getByRole('link',{name:'متابعة الأمسية'})).toHaveAttribute('href','/play')
  expect(screen.getByRole('link',{name:'دخول الفريق / الإدارة'})).toHaveAttribute('href','/admin/login')
  fireEvent.click(screen.getByRole('button',{name:'استرجاع دخولي'}))
  expect(screen.getByRole('button',{name:/استرجاع الدخول/})).toBeEnabled()
})
it('backend close racing an open form gives Arabic error without a false success', async () => {
  mocks.register.mockRejectedValue(new Error('registration_closed')); view('/join')
  fireEvent.change(document.querySelector('input[type=text]')!,{target:{value:'مشارك'}})
  fireEvent.change(document.querySelector('input[type=tel]')!,{target:{value:'91234567'}})
  fireEvent.click(screen.getByRole('button',{name:/انضم الآن/}))
  expect(await screen.findByRole('alert')).toHaveTextContent('التسجيل مغلق حاليًا')
})
it('join reacts to closed/open snapshots without a new polling mechanism', () => {
  const rendered=view('/join'); expect(screen.getByRole('button',{name:/انضم الآن/})).toBeEnabled()
  mocks.state={...mocks.state,registrationOpen:false}; rendered.rerender(<MemoryRouter initialEntries={['/join']}><App /></MemoryRouter>)
  expect(screen.getByText('التسجيل مغلق حاليًا')).toBeInTheDocument()
  mocks.state={...mocks.state,registrationOpen:true}; rendered.rerender(<MemoryRouter initialEntries={['/join']}><App /></MemoryRouter>)
  expect(screen.getByRole('button',{name:/انضم الآن/})).toBeEnabled()
})
it('closed join offers exact pending recovery retry, not a fresh registration', async () => {
  prepareRegistration('مشارك','+96891234567'); mocks.state.registrationOpen=false
  mocks.register.mockResolvedValue({token:'a'.repeat(64),participantPublicId:'p',displayName:'مشارك',recoveryCode:'ABCD-1234'})
  view('/join'); fireEvent.click(screen.getByRole('button',{name:'استرجاع التسجيل السابق'}))
  await waitFor(()=>expect(mocks.register).toHaveBeenCalledWith('مشارك','+96891234567'))
  expect(await screen.findByText('تم تسجيلك')).toBeInTheDocument()
})

