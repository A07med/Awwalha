import { usePublicState } from '../hooks/use-public-state'
import { useScheduledClock } from '../hooks/use-scheduled-clock'
import { useClockSync } from '../hooks/use-clock-sync'
import { demoTaifState } from '../lib/demo-state'

export function StageTaifPage() {
  const { state } = usePublicState({ phase: 'active', operator: true }, demoTaifState)
  const round = state.currentGame === 'taif' ? state.round : null
  const offsetMs = useClockSync(Boolean(round?.startsAt))
  const { elapsedMs } = useScheduledClock(round?.startsAt, offsetMs)
  const revealElapsedMs = round?.revealAt && round.startsAt ? Date.parse(round.revealAt) - Date.parse(round.startsAt) : 6000
  const active = round?.phase === 'active' && elapsedMs >= 0
  const revealed = active && elapsedMs >= revealElapsedMs

  if (revealed) return <main className="taif-stage-final" dir="rtl"><h1>لدينا ٤ فائزين</h1></main>
  if (active) return <main className="taif-stage-active" aria-label="طيف" />
  return <main className="taif-stage-ready" dir="rtl"><div className="taif-stage-orb" /><p>أولها تقدم</p><h1>طَيْف</h1><strong>{state.submittedCount} مستعد</strong></main>
}
