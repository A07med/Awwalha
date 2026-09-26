import { useEffect, useRef, useState } from 'react'
import { adminRoundStatus } from '../lib/api'

export type OperatorStatusError = 'authorization' | 'reauthenticate' | 'invalid_round' | 'unavailable'
export function operatorFailure(reason: unknown): OperatorStatusError | null {
  const error = reason as { message?: string; status?: number; code?: string } | null
  if (error?.message === 'admin_required' || error?.status === 403) return 'authorization'
  if (error?.status === 401 || ['PGRST301', 'PGRST303'].includes(error?.code ?? '')) return 'reauthenticate'
  if (error?.message === 'invalid_round') return 'invalid_round'
  if (error?.status && error.status >= 400 && error.status < 500 && error.status !== 429) return 'unavailable'
  return null
}

export function useOperatorRoundStatus(roundId: string | null, refreshPublicState?: () => Promise<void>) {
  const [status, setStatus] = useState<{ roundId: string; submittedCount: number } | null>(null)
  const [failure, setFailure] = useState<{ roundId: string; error: OperatorStatusError } | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  const invalidRounds = useRef(new Set<string>())
  const authFailed = useRef<OperatorStatusError | null>(null)
  const refreshRef = useRef(refreshPublicState)
  refreshRef.current = refreshPublicState
  useEffect(() => {
    if (!roundId || import.meta.env.VITE_APP_MODE !== 'supabase') return
    let stopped = false
    let timer: number | undefined
    let controller: AbortController | undefined
    let failures = 0
    let halted = invalidRounds.current.has(roundId) || !!authFailed.current
    if (!halted) setFailure(null)
    const poll = async () => {
      // Also serialize requests across round changes/StrictMode cleanup.
      if (inFlight.current) await inFlight.current
      if (stopped || halted || document.hidden) return
      if (inFlight.current) return
      controller = new AbortController()
      const timeout = window.setTimeout(() => controller?.abort(), 3000)
      const pending = (async () => {
        try {
          const next = await adminRoundStatus(roundId, controller!.signal)
          if (!stopped && !document.hidden && !controller!.signal.aborted) setStatus({ roundId, submittedCount: next.submittedCount })
          failures = 0
        } catch (reason) {
          if (stopped || document.hidden) return
          const deterministic = operatorFailure(reason)
          failures++
          const terminal = deterministic ?? (failures >= 5 ? 'unavailable' : null)
          if (terminal) {
            halted = true
            setFailure({ roundId, error: terminal })
            if (terminal === 'authorization' || terminal === 'reauthenticate') authFailed.current = terminal
            if (terminal === 'invalid_round') {
              invalidRounds.current.add(roundId)
              // One request for fresh cached public state; never retry this
              // known-invalid ID, even after visibility changes/cache replay.
              void refreshRef.current?.().catch(() => {})
            }
          }
        }
        finally { window.clearTimeout(timeout) }
      })()
      inFlight.current = pending
      await pending
      if (inFlight.current === pending) inFlight.current = null
      if (!stopped && !halted && !document.hidden) {
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
  const error = authFailed.current ?? (roundId && invalidRounds.current.has(roundId) ? 'invalid_round' : failure?.roundId === roundId ? failure.error : null)
  return { submittedCount: !error && status?.roundId === roundId ? status.submittedCount : null, error }
}
