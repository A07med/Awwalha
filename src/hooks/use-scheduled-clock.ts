import { useEffect, useRef, useState } from 'react'

export function useScheduledClock(startsAt: string | null | undefined, offsetMs = 0, roundId: string | null = null) {
  const [clock, setClock] = useState({ startsAt, roundId, elapsedMs: Number.NEGATIVE_INFINITY })
  const frameRef = useRef<number | null>(null)
  const localStartRef = useRef<number | null>(null)
  const identityRef = useRef<{ startsAt: string; roundId: string | null } | null>(null)

  useEffect(() => {
    if (!startsAt) return
    const serverStart = Date.parse(startsAt)
    const localStartEpoch = serverStart - offsetMs
    const sameRound = identityRef.current?.startsAt === startsAt && identityRef.current.roundId === roundId
    // A late clock-sync response can refine a future countdown, but must not
    // move an already-running monotonic scoring clock backwards or forwards.
    if (!sameRound || localStartRef.current === null || performance.now() < localStartRef.current) {
      localStartRef.current = performance.now() + (localStartEpoch - Date.now())
    }
    identityRef.current = { startsAt, roundId }
    const tick = () => {
      const elapsed = performance.now() - (localStartRef.current as number)
      setClock({ startsAt, roundId, elapsedMs: elapsed })
      frameRef.current = requestAnimationFrame(tick)
    }
    tick()
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current) }
  }, [startsAt, offsetMs, roundId])

  // A new round must never inherit the previous round's elapsed time, even
  // during the render before its clock effect runs.
  return { elapsedMs: clock.startsAt === startsAt && clock.roundId === roundId ? clock.elapsedMs : Number.NEGATIVE_INFINITY, localStart: localStartRef.current }
}
