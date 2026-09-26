import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clock3, Eye, Sparkles, Trophy, UsersRound } from 'lucide-react'
import { PageShell } from '../components/page-shell'
import { Button, Card, StatusPill } from '../components/ui'
import { usePublicState, useTaifRevealRefresh } from '../hooks/use-public-state'
import { useScheduledClock } from '../hooks/use-scheduled-clock'
import { demoLobbyState, demoPerfectState } from '../lib/demo-state'
import { submitFirstLook, submitPerfectSecond } from '../lib/api'
import { readSession } from '../lib/session'
import { perfectSecondScore } from '../lib/ranking'
import { useClockSync } from '../hooks/use-clock-sync'
import { TaifScreen } from '../components/taif-screen'
import { scheduledInteractionActive } from '../lib/scheduled-activation'

type SubmissionStatus = 'idle' | 'locally_submitted' | 'submitting' | 'confirmed' | 'failed'

type PerfectAttempt = {
  kind: 'perfect_second'
  roundId: string
  elapsedMs: number
  metadata: Record<string, unknown>
  result: string
}

type FirstLookAttempt = {
  kind: 'first_look'
  roundId: string
  guess: number
}

type SubmissionAttempt = PerfectAttempt | FirstLookAttempt
type SubmissionState = { status: 'idle' } | { status: Exclude<SubmissionStatus, 'idle'>; attempt: SubmissionAttempt }

const idleSubmission: SubmissionState = { status: 'idle' }
const submissionStoragePrefix = 'awwalha.participant.submission.v1'

function storageKey(participantPublicId: string) {
  return `${submissionStoragePrefix}.${participantPublicId}`
}

function readStoredSubmission(participantPublicId: string): SubmissionState {
  try {
    const value = sessionStorage.getItem(storageKey(participantPublicId))
    if (!value) return idleSubmission
    const parsed = JSON.parse(value) as SubmissionState
    if (!parsed || parsed.status === 'idle' || !('attempt' in parsed) || !parsed.attempt?.roundId) return idleSubmission
    if (!['perfect_second', 'first_look'].includes(parsed.attempt.kind)) return idleSubmission
    // A navigation/reload makes an in-flight request unknowable. Keep the exact
    // attempt, but require an explicit retry rather than inventing a new one.
    if (parsed.status === 'locally_submitted' || parsed.status === 'submitting') return { ...parsed, status: 'failed' }
    return parsed
  } catch {
    return idleSubmission
  }
}

function storeSubmission(participantPublicId: string, submission: SubmissionState) {
  try {
    if (submission.status === 'idle') sessionStorage.removeItem(storageKey(participantPublicId))
    else sessionStorage.setItem(storageKey(participantPublicId), JSON.stringify(submission))
  } catch {
    // sessionStorage can be unavailable in private/restricted browser contexts.
  }
}

function formatSignedSeconds(signedDeltaMs: number) {
  return `${signedDeltaMs >= 0 ? '+' : ''}${(signedDeltaMs / 1000).toFixed(3)}s`
}

function isDuplicateAttempt(error: unknown) {
  return error instanceof Error && /attempt_already_submitted/i.test(error.message)
}

function SubmissionFeedback({ submission, onRetry }: { submission: Exclude<SubmissionState, { status: 'idle' }>; onRetry: () => void }) {
  const pending = submission.status === 'locally_submitted' || submission.status === 'submitting'
  const perfect = submission.attempt.kind === 'perfect_second'

  return <div className={'submitted-result submission-feedback ' + submission.status} data-submission-state={submission.status} aria-live="polite" aria-atomic="true">
    {submission.status === 'confirmed' ? <Check aria-hidden="true" /> : <span className="submission-symbol" aria-hidden="true">⚡</span>}
    <span className="submission-title">
      {submission.status === 'confirmed' ? 'تم التأكيد ✓' : perfect ? 'تم تسجيل ضغطتك ⚡' : 'تم تسجيل إجابتك'}
    </span>
    {pending ? <small className="submission-progress-label"><span className="submission-spinner" aria-hidden="true" />{perfect ? 'جاري تأكيدها...' : 'جاري التأكيد...'}</small> : null}
    {submission.status === 'failed' ? <><small className="submission-error">تعذر تأكيد الإرسال</small><Button type="button" className="retry-button" onClick={onRetry}>إعادة المحاولة</Button></> : null}
    {submission.status === 'confirmed' && submission.attempt.kind === 'perfect_second' ? <strong dir="ltr">{submission.attempt.result}</strong> : null}
    {submission.attempt.kind === 'first_look' ? <strong>إجابتك: {submission.attempt.guess}</strong> : null}
    {submission.status === 'confirmed' ? <small>النتيجة النهائية تظهر بعد إغلاق الجولة</small> : null}
  </div>
}

export function PlayPage() {
  const session = readSession() ?? { token: 'demo-session', participantPublicId: 'demo-participant', displayName: 'أحمد' }
  const [submission, setSubmission] = useState<SubmissionState>(() => readStoredSubmission(session.participantPublicId))
  const [timingCritical, setTimingCritical] = useState(false)
  const [guess, setGuess] = useState(() => submission.status !== 'idle' && submission.attempt.kind === 'first_look' ? String(submission.attempt.guess) : '')
  const [taifReady, setTaifReady] = useState(false)
  const updateTaifReady = useCallback((ready: boolean) => setTaifReady(ready), [])
  const submitted = submission.status !== 'idle'
  const attemptLockRef = useRef<string | null>(submission.status === 'idle' ? null : submission.attempt.roundId)
  // Never let the live app's illustrative active round block its first real
  // state request on a slow connection.
  const initialState = import.meta.env.VITE_APP_MODE === 'supabase' ? demoLobbyState : demoPerfectState
  const { state, refreshAtTaifReveal } = usePublicState({ submitted, timingCritical, taifReady }, initialState)
  const round = state.round
  const currentRoundIdRef = useRef<string | null>(round?.id ?? null)
  currentRoundIdRef.current = round?.id ?? null
  const offsetMs = useClockSync(Boolean(round?.startsAt))
  const { elapsedMs } = useScheduledClock(round?.startsAt, offsetMs, round?.id ?? null)
  const active = round?.gameType === 'taif'
    ? round.phase === 'active' && elapsedMs >= 0
    : scheduledInteractionActive(state, round?.id ?? null, elapsedMs, session.participantPublicId)
  const taifRevealElapsedMs = round?.revealAt && round.startsAt ? Date.parse(round.revealAt) - Date.parse(round.startsAt) : 6000
  useTaifRevealRefresh(round?.gameType === 'taif' && active && elapsedMs >= taifRevealElapsedMs && state.taifWinners.length !== 4 ? round.id : null, refreshAtTaifReveal)
  useEffect(() => setTimingCritical(Boolean(active && !submitted && round?.gameType !== 'taif')), [active, submitted, round?.gameType])
  useEffect(() => {
    const stored = readStoredSubmission(session.participantPublicId)
    if (round && stored.status !== 'idle' && stored.attempt.roundId === round.id) {
      attemptLockRef.current = round.id
      setSubmission(stored)
      if (stored.attempt.kind === 'first_look') setGuess(String(stored.attempt.guess))
      return
    }
    attemptLockRef.current = null
    setSubmission(idleSubmission)
    setGuess('')
    storeSubmission(session.participantPublicId, idleSubmission)
  }, [round?.id, session.participantPublicId])
  const hiddenTimer = active && round?.gameType === 'perfect_second' && elapsedMs > (round.hideTimerAfterMs ?? 1500)
  const isTieRound = Boolean(round?.parentRoundId) || state.phase === 'tie_break'
  const isTieEligible = isTieRound && state.tieEligiblePublicIds.includes(session.participantPublicId)
  const isTieSpectator = isTieRound && !isTieEligible
  const winner = state.winners.find((item) => item.participantPublicId === session.participantPublicId)
  const revealedWithoutWin = state.phase === 'revealed' && !winner

  const countdown = useMemo(() => elapsedMs < 0 ? Math.max(1, Math.ceil(Math.abs(elapsedMs) / 1000)) : 0, [elapsedMs])

  if (round?.gameType === 'taif') return <TaifScreen state={state} session={session} elapsedMs={elapsedMs} onReadyChange={updateTaifReady} />

  function updateSubmission(status: Exclude<SubmissionStatus, 'idle'>, attempt: SubmissionAttempt) {
    if (currentRoundIdRef.current !== attempt.roundId) return
    const next: SubmissionState = { status, attempt }
    storeSubmission(session.participantPublicId, next)
    setSubmission(next)
  }

  async function sendAttempt(attempt: SubmissionAttempt) {
    updateSubmission('submitting', attempt)
    try {
      if (import.meta.env.VITE_APP_MODE === 'supabase') {
        if (attempt.kind === 'perfect_second') {
          const response = await submitPerfectSecond(session.token, attempt.roundId, attempt.elapsedMs, attempt.metadata)
          attempt = { ...attempt, result: formatSignedSeconds(response.signedDeltaMs) }
        } else {
          await submitFirstLook(session.token, attempt.roundId, attempt.guess)
        }
      }
      updateSubmission('confirmed', attempt)
    } catch (error) {
      if (isDuplicateAttempt(error)) updateSubmission('confirmed', attempt)
      else updateSubmission('failed', attempt)
    }
  }

  function queueAttempt(attempt: SubmissionAttempt) {
    updateSubmission('locally_submitted', attempt)
    queueMicrotask(() => void sendAttempt(attempt))
  }

  function stop() {
    if (!round || attemptLockRef.current || !active || isTieSpectator) return
    attemptLockRef.current = round.id
    const capturedElapsedMs = Math.max(0, elapsedMs)
    const own = perfectSecondScore(capturedElapsedMs, round.targetMs ?? 6000)
    queueAttempt({
      kind: 'perfect_second',
      roundId: round.id,
      elapsedMs: capturedElapsedMs,
      metadata: { visibilityState: document.visibilityState, clock: 'performance.now' },
      result: formatSignedSeconds(own.signedDeltaMs),
    })
  }

  function confirmGuess(event: React.FormEvent) {
    event.preventDefault()
    if (!round || attemptLockRef.current || !active || isTieSpectator || !/^\d+$/.test(guess)) return
    attemptLockRef.current = round.id
    queueAttempt({ kind: 'first_look', roundId: round.id, guess: Number(guess) })
  }

  function retry() {
    if (submission.status !== 'failed') return
    queueAttempt(submission.attempt)
  }

  return <PageShell className="play-page">
    <section className="participant-top"><div><span>مساء الخير،</span><h1>{session.displayName}</h1></div><StatusPill>مشارك <bdi dir="ltr">#{session.participantPublicId.slice(-4).toUpperCase()}</bdi></StatusPill></section>
    {winner ? <Card className="participant-panel result-panel winner-panel" aria-live="polite"><span className="result-emoji" aria-hidden="true">🎉</span><Trophy /><p className="eyebrow">النتيجة النهائية</p><h2>أنت من الفائزين</h2><p>اسمك الآن على الشاشة الكبيرة.</p></Card>
    : revealedWithoutWin ? <Card className="participant-panel result-panel" aria-live="polite"><Sparkles /><p className="eyebrow">انتهت الجولة</p><h2>شكرًا لمشاركتك</h2><p>خلك قريب — الجولة القادمة قد تكون لك.</p></Card>
    : isTieSpectator ? <Card className="participant-panel result-panel tie-spectator" aria-live="polite"><Sparkles /><p className="eyebrow">تعادل</p><h2>جولة فاصلة جارية</h2><p>تابع الشاشة — هذه الجولة للمشاركين المتعادلين.</p></Card>
    : !round ? <Card className="participant-panel lobby-panel"><div className="waiting-symbol" aria-hidden="true"><UsersRound /></div><h2>بانتظار بدء اللعبة...</h2><p>ابقَ على هذه الصفحة، ستبدأ الجولة هنا تلقائيًا ✨</p></Card>
    : round.gameType === 'perfect_second' ? <Card className="participant-panel game-panel perfect-panel">
      {isTieEligible && <div className="tie-break-callout"><strong>تعادل!</strong><span>أنت داخل الجولة الفاصلة</span></div>}
      <div className="game-kicker"><Clock3 /> الثانية المثالية</div>
      <p>اضغط عندما تعتقد أننا وصلنا إلى</p>
      <h2 className="target-number" dir="ltr">{((round.targetMs ?? 6000) / 1000).toFixed(3)}<small> ثانية</small></h2>
      <div className={'phone-timer ' + (hiddenTimer ? 'hidden-time ' : '') + (submitted ? 'timer-placeholder' : '')} dir="ltr">{!active ? countdown : hiddenTimer ? '?.???' : (elapsedMs / 1000).toFixed(3)}</div>
      <div className={'stop-action ' + (submitted ? 'submitted' : '')}>
        <Button className="stop-button" onPointerDown={stop} onClick={stop} disabled={!active || submitted} tabIndex={submitted ? -1 : 0}>STOP</Button>
        {submission.status !== 'idle' ? <SubmissionFeedback submission={submission} onRetry={retry} /> : null}
      </div>
    </Card>
    : <Card className="participant-panel game-panel look-panel">
      {isTieEligible && <div className="tie-break-callout"><strong>تعادل!</strong><span>أنت داخل الجولة الفاصلة</span></div>}
      <div className="game-kicker"><Eye /> أول نظرة</div>
      <p>كم عنصر شفت؟</p>
      <form className={'guess-form ' + (submitted ? 'submitted' : '')} onSubmit={confirmGuess}>
        <input aria-label="عدد العناصر" type="number" min="0" max="999" inputMode="numeric" pattern="[0-9]*" enterKeyHint="done" value={guess} onChange={(event) => setGuess(event.target.value)} placeholder="؟" autoFocus disabled={!active || submitted} />
        <div className="guess-submit-slot">
          <Button type="submit" disabled={!active || submitted} tabIndex={submitted ? -1 : 0}>تأكيد</Button>
          {submission.status !== 'idle' ? <SubmissionFeedback submission={submission} onRetry={retry} /> : null}
        </div>
      </form>
    </Card>}
    <footer className="participant-footer"><span className="connection-dot" /> التحديث موزّع تلقائيًا <span>·</span> لا تغلق الصفحة</footer>
  </PageShell>
}
