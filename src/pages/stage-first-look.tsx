import { useEffect, useState } from 'react'
import { Eye, UsersRound } from 'lucide-react'
import { AmbientBackground, Wordmark } from '../components/brand'
import { StatusPill } from '../components/ui'
import { VisualField } from '../components/visual-field'
import { WinnerGrid } from '../components/winner-grid'
import { usePublicState } from '../hooks/use-public-state'
import { useScheduledClock } from '../hooks/use-scheduled-clock'
import { demoFirstLookState } from '../lib/demo-state'
import { adminRoundDetail } from '../lib/api'
import { useClockSync } from '../hooks/use-clock-sync'

export function StageFirstLookPage() {
  const { state } = usePublicState({ phase: 'active', operator: true }, demoFirstLookState)
  const round = state.round
  const [privateRound, setPrivateRound] = useState<{ correctCount: number; visualSeed: number; visualCategory: 'seeds' | 'leaves' | 'fish' | 'bubbles' | 'drops'; displayDurationMs: number } | null>(null)
  useEffect(() => {
    if (import.meta.env.VITE_APP_MODE === 'supabase' && round?.id) void adminRoundDetail(round.id).then(setPrivateRound)
  }, [round?.id])
  const offsetMs = useClockSync(Boolean(round?.startsAt))
  const { elapsedMs } = useScheduledClock(round?.startsAt, offsetMs)
  const show = elapsedMs >= 0 && elapsedMs < (privateRound?.displayDurationMs ?? round?.displayDurationMs ?? 1800)
  const countdown = elapsedMs < 0 ? Math.max(1, Math.ceil(-elapsedMs / 1000)) : 0
  const visualCount = privateRound?.correctCount ?? 36
  return <main className="stage-page look-stage" dir="rtl"><AmbientBackground /><header className="stage-header"><Wordmark /><div><StatusPill tone="gold"><Eye size={16} /> أول نظرة</StatusPill><span>ركز… عندك لحظتان فقط</span></div></header>
    {state.phase === 'revealed' && state.winners.length ? <section className="stage-winners"><p className="eyebrow">أدق الملاحظات</p><h1>الفائزون</h1><WinnerGrid winners={state.winners} game="first_look" /></section>
    : countdown ? <section className="look-message"><p>ركز</p><strong>{countdown}</strong></section>
    : show || import.meta.env.VITE_APP_MODE !== 'supabase' ? <section className="look-field-wrap"><VisualField seed={privateRound?.visualSeed ?? round?.visualSeed ?? 90731} count={visualCount} category={privateRound?.visualCategory ?? round?.visualCategory ?? 'leaves'} /><span className="look-hint">عدّها بنظرة واحدة</span></section>
    : <section className="look-message"><Eye /><p>كم كانوا؟</p><strong>؟</strong></section>}
    <footer className="stage-footer"><span><UsersRound /> {state.registeredCount} مشاركًا</span><span className="submission-progress"><i style={{ width: Math.min(100, state.submittedCount / Math.max(1, state.registeredCount) * 100) + '%' }} /></span><strong>{state.submittedCount} إجابة</strong></footer>
  </main>
}
