import { useEffect, useState } from 'react'
import { syncClock } from '../lib/clock'

export function useClockSync(enabled: boolean) {
  const [offsetMs, setOffsetMs] = useState(0)
  useEffect(() => {
    if (!enabled || import.meta.env.VITE_APP_MODE !== 'supabase') return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void syncClock(3, controller.signal).then((sample) => setOffsetMs(sample.offsetMs)).catch(() => undefined)
    }, 300 + Math.random() * 2200)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [enabled])
  return offsetMs
}
