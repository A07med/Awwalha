import { usePublicState, useTaifRevealRefresh } from '../hooks/use-public-state'
import { useScheduledClock } from '../hooks/use-scheduled-clock'
import { useClockSync } from '../hooks/use-clock-sync'
import { demoLobbyState, demoTaifState } from '../lib/demo-state'

export function StageTaifPage() {
  const initialState = import.meta.env.VITE_APP_MODE === 'supabase' ? demoLobbyState : demoTaifState
  const { state, refreshAtTaifReveal } = usePublicState({ phase: 'active', operator: true }, initialState)
  const round = state.currentGame === 'taif' ? state.round : null
  const offsetMs = useClockSync(Boolean(round?.startsAt))
  const { elapsedMs } = useScheduledClock(round?.startsAt, offsetMs)
  const revealElapsedMs = round?.revealAt && round.startsAt ? Date.parse(round.revealAt) - Date.parse(round.startsAt) : 6000
  const active = round?.phase === 'active' && elapsedMs >= 0
  const revealDue = active && elapsedMs >= revealElapsedMs
  useTaifRevealRefresh(revealDue && state.taifWinners.length !== 4 ? round?.id ?? null : null, refreshAtTaifReveal)
  const revealed = revealDue && state.taifWinners.length === 4

  if (revealed) return <main className="taif-stage-final" dir="rtl"><h1>لدينا ٤ فائزين</h1></main>
  if (active) return <main className="taif-stage-active" aria-label="طيف" />
  return <main className="taif-stage-ready" dir="rtl"><img className="taif-stage-brand" src="/awwalha-wordmark.svg" alt="أولها" /><div className="taif-stage-orb" /><p>أولها تقدم</p><h1>طَيْف</h1><strong>{state.submittedCount} مستعد</strong></main>
}
