import { useEffect, useMemo, useState } from 'react'
import { Check, Clock3, Eye, Sparkles, Trophy } from 'lucide-react'
import { PageShell } from '../components/page-shell'
import { Button, Card, StatusPill } from '../components/ui'
import { usePublicState } from '../hooks/use-public-state'
import { useScheduledClock } from '../hooks/use-scheduled-clock'
import { demoPerfectState } from '../lib/demo-state'
import { submitFirstLook, submitPerfectSecond } from '../lib/api'
import { readSession } from '../lib/session'
import { perfectSecondScore } from '../lib/ranking'
import { useClockSync } from '../hooks/use-clock-sync'

export function PlayPage() {
  const session = readSession() ?? { token: 'demo-session', participantPublicId: 'demo-participant', displayName: 'أحمد' }
  const [submitted, setSubmitted] = useState(false)
  const [timingCritical, setTimingCritical] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [guess, setGuess] = useState('')
  const { state } = usePublicState({ submitted, timingCritical }, demoPerfectState)
  const round = state.round
  const offsetMs = useClockSync(Boolean(round?.startsAt))
  const { elapsedMs } = useScheduledClock(round?.startsAt, offsetMs)
  const active = round?.phase === 'active' && elapsedMs >= 0
  useEffect(() => setTimingCritical(Boolean(active && !submitted)), [active, submitted])
  const hiddenTimer = active && round?.gameType === 'perfect_second' && elapsedMs > (round.hideTimerAfterMs ?? 1500)
  const isTieSpectator = state.phase === 'tie_break' && !state.tieEligiblePublicIds.includes(session.participantPublicId)
  const winner = state.winners.find((item) => item.participantPublicId === session.participantPublicId)

  const countdown = useMemo(() => elapsedMs < 0 ? Math.max(1, Math.ceil(Math.abs(elapsedMs) / 1000)) : 0, [elapsedMs])

  async function stop() {
    if (!round || submitted || !active) return
    const elapsed = Math.max(0, elapsedMs)
    setSubmitted(true)
    const own = perfectSecondScore(elapsed, round.targetMs ?? 6000)
    setResult((own.signedDeltaMs >= 0 ? '+' : '') + (own.signedDeltaMs / 1000).toFixed(3) + 's')
    if (import.meta.env.VITE_APP_MODE === 'supabase') {
      await submitPerfectSecond(session.token, round.id, elapsed, { visibilityState: document.visibilityState, clock: 'performance.now' })
    }
  }

  async function confirmGuess(event: React.FormEvent) {
    event.preventDefault()
    if (!round || submitted || !/^\d+$/.test(guess)) return
    setSubmitted(true)
    setResult('إجابتك: ' + guess)
    if (import.meta.env.VITE_APP_MODE === 'supabase') await submitFirstLook(session.token, round.id, Number(guess))
  }

  return <PageShell className="play-page">
    <section className="participant-top"><div><span>مساء الخير،</span><h1>{session.displayName}</h1></div><StatusPill>مشارك #{session.participantPublicId.slice(-4).toUpperCase()}</StatusPill></section>
    {winner ? <Card className="participant-panel winner-panel"><Trophy /><p className="eyebrow">من الفائزين</p><h2>أنت أولها ✦</h2><p>اسمك الآن على الشاشة الكبيرة.</p></Card>
    : isTieSpectator ? <Card className="participant-panel"><Sparkles /><h2>جولة فاصلة جارية</h2><p>تابع الشاشة — هذه الجولة للمشاركين المتعادلين.</p></Card>
    : !round ? <Card className="participant-panel"><span className="pulse-orbit"><span /></span><p className="eyebrow">أنت داخل</p><h2>خلك جاهز</h2><p>بتظهر الجولة هنا قبل بدايتها. ما يحتاج تحدث الصفحة.</p></Card>
    : round.gameType === 'perfect_second' ? <Card className="participant-panel game-panel perfect-panel">
      <div className="game-kicker"><Clock3 /> الثانية المثالية</div>
      <p>اضغط عندما تعتقد أننا وصلنا إلى</p>
      <h2 className="target-number" dir="ltr">{((round.targetMs ?? 6000) / 1000).toFixed(3)}<small> ثانية</small></h2>
      {!submitted && <div className={'phone-timer ' + (hiddenTimer ? 'hidden-time' : '')} dir="ltr">{!active ? countdown : hiddenTimer ? '?.???' : (elapsedMs / 1000).toFixed(3)}</div>}
      {submitted ? <div className="submitted-result"><Check /><span>تم تسجيل محاولتك</span><strong dir="ltr">{result}</strong><small>النتيجة النهائية تظهر بعد إغلاق الجولة</small></div>
        : <Button className="stop-button" onPointerDown={stop} disabled={!active}>STOP</Button>}
    </Card>
    : <Card className="participant-panel game-panel look-panel">
      <div className="game-kicker"><Eye /> أول نظرة</div>
      <p>كم عنصر شفت؟</p>
      {submitted ? <div className="submitted-result"><Check /><span>تم تثبيت إجابتك</span><strong>{result}</strong><small>انتظر كشف الإجابة على الشاشة</small></div>
      : <form className="guess-form" onSubmit={confirmGuess}><input aria-label="عدد العناصر" inputMode="numeric" pattern="[0-9]*" value={guess} onChange={(event) => setGuess(event.target.value)} placeholder="؟" autoFocus /><Button type="submit">تأكيد</Button></form>}
    </Card>}
    <footer className="participant-footer"><span className="connection-dot" /> التحديث موزّع تلقائيًا <span>·</span> لا تغلق الصفحة</footer>
  </PageShell>
}
