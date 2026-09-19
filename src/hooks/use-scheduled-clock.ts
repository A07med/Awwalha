import { useEffect, useRef, useState } from 'react'

export function useScheduledClock(startsAt: string | null | undefined, offsetMs = 0) {
  const [elapsedMs, setElapsedMs] = useState(0)
  const frameRef = useRef<number | null>(null)
  const localStartRef = useRef<number | null>(null)

  useEffect(() => {
    if (!startsAt) return
    const serverStart = Date.parse(startsAt)
    const localStartEpoch = serverStart - offsetMs
    localStartRef.current = performance.now() + (localStartEpoch - Date.now())
    const tick = () => {
      const elapsed = performance.now() - (localStartRef.current as number)
      setElapsedMs(elapsed)
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current) }
  }, [startsAt, offsetMs])

  return { elapsedMs, localStart: localStartRef.current }
}
