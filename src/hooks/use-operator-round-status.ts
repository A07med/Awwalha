import { useEffect, useRef, useState } from 'react'
import { adminRoundStatus } from '../lib/api'

export function useOperatorRoundStatus(roundId: string | null) {
  const [status, setStatus] = useState<{ roundId: string; submittedCount: number } | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  useEffect(() => {
    if (!roundId || import.meta.env.VITE_APP_MODE !== 'supabase') return
    let stopped = false
    let timer: number | undefined
    let controller: AbortController | undefined
    let failures = 0
    const poll = async () => {
      // Also serialize requests across round changes/StrictMode cleanup.
      if (inFlight.current) await inFlight.current
      if (stopped || document.hidden) return
      if (inFlight.current) return
      controller = new AbortController()
      const timeout = window.setTimeout(() => controller?.abort(), 3000)
      const pending = (async () => {
        try {
          const next = await adminRoundStatus(roundId, controller!.signal)
          if (!stopped && !document.hidden && !controller!.signal.aborted) setStatus({ roundId, submittedCount: next.submittedCount })
          failures = 0
        } catch { failures = Math.min(failures + 1, 2) }
        finally { window.clearTimeout(timeout) }
      })()
      inFlight.current = pending
      await pending
      if (inFlight.current === pending) inFlight.current = null
      if (!stopped && !document.hidden) {
        window.clearTimeout(timer)
        timer = window.setTimeout(() => void poll(), Math.min(6000, (1000 + Math.random() * 500) * 2 ** failures))
      }
    }
    const visibility = () => {
      window.clearTimeout(timer)
      if (document.hidden) controller?.abort()
      else void poll()
    }
    void poll()
    document.addEventListener('visibilitychange', visibility)
    return () => {
      stopped = true
      window.clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [roundId])
  return status?.roundId === roundId ? status.submittedCount : null
}
