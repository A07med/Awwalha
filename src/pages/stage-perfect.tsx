import { WinnerGrid } from '../components/winner-grid'
import { Projector, StageCountdown, StageWaiting } from '../components/projector'
import { usePublicState } from '../hooks/use-public-state'
import { useScheduledClock } from '../hooks/use-scheduled-clock'
import { demoPerfectState } from '../lib/demo-state'
import { useClockSync } from '../hooks/use-clock-sync'
import { ownStageRound, stageLoadingState, stagePhase } from '../lib/stage-state'

export function StagePerfectPage() {
  const real = import.meta.env.VITE_APP_MODE === 'supabase'
  const { state, hydrated } = usePublicState({ operator: true }, real ? stageLoadingState : demoPerfectState)
  const round = ownStageRound(state, 'perfect_second', real)
  const offsetMs = useClockSync(Boolean(round?.startsAt))
  const { elapsedMs } = useScheduledClock(round?.startsAt, offsetMs, round?.id)
  const phase = stagePhase(hydrated, round, elapsedMs)
  const hidden = elapsedMs >= (round?.hideTimerAfterMs ?? 1500)
  return <Projector game="perfect_second" phase={phase} registered={hydrated ? state.registeredCount : undefined} submitted={round ? state.submittedCount : 0} metric="محاولة">
    {phase === 'revealed' && state.winners.length ? <div className="projector-winners"><span className="projector-kicker">أقرب اللحظات</span><h1>الفائزون</h1><WinnerGrid winners={state.winners} game="perfect_second" /></div>
      : phase === 'countdown' ? <StageCountdown elapsedMs={elapsedMs} />
        : phase === 'active' && round?.targetMs !== undefined ? <div className="projector-perfect"><h1>الثانية المثالية</h1><span className="projector-kicker">الوقت المستهدف</span><div className="projector-target" dir="ltr">{(round.targetMs / 1000).toFixed(3)}</div><span className="projector-unit">ثانية</span><div className={'projector-timer ' + (hidden ? 'masked' : '')} dir="ltr">{hidden ? '?.???' : (elapsedMs / 1000).toFixed(3)}</div></div>
          : <StageWaiting game="perfect_second" phase={phase} />}
  </Projector>
}
