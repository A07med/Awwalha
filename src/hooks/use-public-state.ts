import { useCallback, useEffect, useRef, useState } from 'react'
import type { PollOptions, PublicEventState } from '../types'
import { fetchPublicState } from '../lib/api'
import { demoLobbyState } from '../lib/demo-state'

export function pollingDelay(options: PollOptions, failureCount: number, random = Math.random()) {
  const base = options.operator ? 600 : options.taifReady ? 1500 : options.submitted ? 7000 : options.phase === 'preparing' || options.phase === 'countdown' ? 2000 : 6000
  const span = options.operator ? 400 : options.taifReady ? 1000 : options.submitted ? 5000 : options.phase === 'preparing' || options.phase === 'countdown' ? 2000 : 4000
  const backoff = Math.min(4, 2 ** failureCount)
  return Math.round((base + random * span) * backoff)
}

export function usePublicState(options: PollOptions = {}, demoState = demoLobbyState) {
  const demo = import.meta.env.VITE_APP_MODE !== 'supabase'
  const [state, setState] = useState<PublicEventState>(demoState)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef<AbortController | null>(null)
  const timerRef = useRef<number | null>(null)
  const failureRef = useRef(0)
  const optionsRef = useRef(options)
  const hydratedRef = useRef(false)
  optionsRef.current = options

  const refresh = useCallback(async () => {
    if (demo || document.hidden || requestRef.current || optionsRef.current.timingCritical) return
    const controller = new AbortController()
    requestRef.current = controller
    try {
      const next = await fetchPublicState(controller.signal)
      setState((current) => {
        if (!hydratedRef.current || next.stateVersion > current.stateVersion) return next
        return current
      })
      hydratedRef.current = true
      failureRef.current = 0
      setError(null)
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        failureRef.current += 1
        setError(reason instanceof Error ? reason.message : 'تعذر التحديث')
      }
    } finally {
      requestRef.current = null
    }
  }, [demo])

  useEffect(() => {
    if (demo || options.active === false || options.timingCritical) return
    let stopped = false
    const schedule = () => {
      if (stopped || document.hidden) return
      timerRef.current = window.setTimeout(async () => {
        await refresh()
        schedule()
      }, pollingDelay(optionsRef.current, failureRef.current))
    }
    void refresh().finally(schedule)
    const onVisibility = () => {
      if (document.hidden) {
        if (timerRef.current) window.clearTimeout(timerRef.current)
        timerRef.current = null
        requestRef.current?.abort()
      } else {
        void refresh().finally(schedule)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (timerRef.current) window.clearTimeout(timerRef.current)
      requestRef.current?.abort()
    }
  }, [demo, options.active, options.timingCritical, refresh])

  return { state, error, refresh, setState }
}
