import { usePublicState, useTaifRevealRefresh } from '../hooks/use-public-state'
import { useScheduledClock } from '../hooks/use-scheduled-clock'
import { useClockSync } from '../hooks/use-clock-sync'
import { demoTaifState } from '../lib/demo-state'
import { ownStageRound, stageLoadingState, stagePhase } from '../lib/stage-state'
import { Projector, StageCountdown, StageMark, StageWaiting } from '../components/projector'

export function StageTaifPage() {
  const real = import.meta.env.VITE_APP_MODE === 'supabase'
  const { state, hydrated, refreshAtTaifReveal } = usePublicState({ operator: true }, real ? stageLoadingState : demoTaifState)
  const round = ownStageRound(state, 'taif', real)
  const offsetMs = useClockSync(Boolean(round?.startsAt))
  const { elapsedMs } = useScheduledClock(round?.startsAt, offsetMs, round?.id)
  const phase = stagePhase(hydrated, round, elapsedMs)
  const revealElapsedMs = round?.revealAt && round.startsAt ? Date.parse(round.revealAt) - Date.parse(round.startsAt) : Infinity
  const active = Boolean(round && ['active', 'revealed', 'closed', 'resolved'].includes(round.phase) && elapsedMs >= 0)
  const revealDue = active && elapsedMs >= revealElapsedMs
  useTaifRevealRefresh(revealDue && state.taifWinners.length !== 4 ? round?.id ?? null : null, refreshAtTaifReveal)
  const revealed = revealDue && state.taifWinners.length === 4
  if (revealed) return <main className="taif-stage-final projector-final" dir="rtl"><h1>لدينا ٤ فائزين</h1></main>
  if (active) return <main className="taif-stage-active" aria-label="وَهَج" />
  return <Projector game="taif" phase={phase}>
    {phase === 'countdown' ? <StageCountdown elapsedMs={elapsedMs} /> : phase === 'preparing' && round ? <div className="projector-message projector-wahaj"><StageMark game="taif" /><h1>وَهَج</h1><p>استعد للّون</p><strong className="projector-ready-count">{state.submittedCount}<span> مستعد</span></strong></div> : <StageWaiting game="taif" phase={phase} />}
  </Projector>
}
