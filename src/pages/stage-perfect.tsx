import { Clock3, UsersRound } from 'lucide-react'
import { AmbientBackground, Wordmark } from '../components/brand'
import { StatusPill } from '../components/ui'
import { WinnerGrid } from '../components/winner-grid'
import { usePublicState } from '../hooks/use-public-state'
import { useScheduledClock } from '../hooks/use-scheduled-clock'
import { demoPerfectState } from '../lib/demo-state'
import { useClockSync } from '../hooks/use-clock-sync'

export function StagePerfectPage() {
  const { state } = usePublicState({ phase: 'active', operator: true }, demoPerfectState)
  const round = state.round
  const offsetMs = useClockSync(Boolean(round?.startsAt))
  const { elapsedMs } = useScheduledClock(round?.startsAt, offsetMs)
  const hidden = elapsedMs > (round?.hideTimerAfterMs ?? 1500)
  const winners = state.winners.length ? state.winners : []
  const countdown = elapsedMs < 0 ? Math.max(1, Math.ceil(-elapsedMs / 1000)) : 0
  return <main className="stage-page perfect-stage" dir="rtl"><AmbientBackground /><header className="stage-header"><Wordmark /><div><StatusPill tone="gold"><Clock3 size={16} /> الثانية المثالية</StatusPill><span>ألعاب حيّة · لحظات لا تتكرر</span></div></header>
    {state.phase === 'revealed' && winners.length ? <section className="stage-winners"><p className="eyebrow">أقرب اللحظات</p><h1>الفائزون</h1><WinnerGrid winners={winners} game="perfect_second" /></section>
    : <section className="stage-center"><p className="stage-prompt">الوقت المستهدف</p><h1 className="stage-target" dir="ltr">{((round?.targetMs ?? 6000) / 1000).toFixed(3)}<small> ثانية</small></h1><div className={'stage-timer ' + (hidden ? 'masked' : '')} dir="ltr">{countdown ? countdown : hidden ? '?.???' : Math.max(0, elapsedMs / 1000).toFixed(3)}</div><p className="stage-instruction">{hidden ? 'احسبها بنفسك' : countdown ? 'استعد' : 'الوقت يمشي الآن'}</p></section>}
    <footer className="stage-footer"><span><UsersRound /> {state.registeredCount} مشاركًا</span><span className="submission-progress"><i style={{ width: Math.min(100, state.submittedCount / Math.max(1, state.registeredCount) * 100) + '%' }} /></span><strong>{state.submittedCount} محاولة</strong></footer>
  </main>
}
