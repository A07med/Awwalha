import { useEffect, useRef, useState } from 'react'
import { Projector, StageCountdown, StageMark, StageWaiting } from '../components/projector'
import { VisualField } from '../components/visual-field'
import { WinnerGrid } from '../components/winner-grid'
import { usePublicState } from '../hooks/use-public-state'
import { useScheduledClock } from '../hooks/use-scheduled-clock'
import { demoFirstLookState } from '../lib/demo-state'
import { adminRoundDetail } from '../lib/api'
import { useClockSync } from '../hooks/use-clock-sync'
import { ownStageRound, stageLoadingState, stagePhase } from '../lib/stage-state'

type Detail = Awaited<ReturnType<typeof adminRoundDetail>>
export function StageFirstLookPage() {
  const real = import.meta.env.VITE_APP_MODE === 'supabase'
  const { state, hydrated } = usePublicState({ operator: true }, real ? stageLoadingState : demoFirstLookState)
  const round = ownStageRound(state, 'first_look', real)
  const requestId = real && hydrated ? round?.id : undefined
  const [detail, setDetail] = useState<{ id: string; data: Detail | null; failed: boolean } | null>(null)
  const request = useRef<{ id: string; promise: Promise<Detail> } | null>(null)
  useEffect(() => {
    setDetail(null)
    if (!requestId) return
    let cancelled = false
    // Share the request across StrictMode replay; polling must not retry failures.
    if (request.current?.id !== requestId) request.current = { id: requestId, promise: adminRoundDetail(requestId) }
    void request.current.promise.then((data) => {
      if (!cancelled) setDetail({ id: requestId, data, failed: false })
    }).catch(() => {
      if (!cancelled) setDetail({ id: requestId, data: null, failed: true })
    })
    return () => { cancelled = true }
  }, [requestId])
  // Clear private data on the first render of a different round, before effects.
  const privateRound = detail?.id === requestId ? detail?.data : null
  const failed = detail?.id === requestId && detail?.failed
  const offsetMs = useClockSync(Boolean(round?.startsAt))
  const { elapsedMs } = useScheduledClock(round?.startsAt, offsetMs, round?.id)
  const phase = stagePhase(hydrated, round, elapsedMs)
  const visual = real ? privateRound : { correctCount: 36, visualSeed: round?.visualSeed ?? 90731, visualCategory: round?.visualCategory ?? 'leaves', displayDurationMs: round?.displayDurationMs ?? 1800 }
  const show = phase === 'active' && visual && elapsedMs < visual.displayDurationMs
  return <Projector game="first_look" phase={phase} registered={hydrated ? state.registeredCount : undefined} submitted={round ? state.submittedCount : 0} metric="إجابة">
    {phase === 'revealed' && state.winners.length ? <div className="projector-winners"><span className="projector-kicker">أدق الملاحظات</span><h1>الفائزون</h1><WinnerGrid winners={state.winners} game="first_look" /></div>
      : phase === 'countdown' ? <StageCountdown elapsedMs={elapsedMs} />
        : show && visual ? <div className="projector-visual"><VisualField projector seed={visual.visualSeed} count={visual.correctCount} category={visual.visualCategory} /></div>
          : phase === 'active' && visual ? <div className="projector-message projector-question"><StageMark game="first_look" /><h1>كم عنصرًا رأيت؟</h1></div>
            : <StageWaiting game="first_look" phase={phase} error={Boolean(failed)} />}
  </Projector>
}
