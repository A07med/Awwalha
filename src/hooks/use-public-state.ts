import { useCallback, useEffect, useRef, useState } from 'react'
import type { PollOptions, PublicEventState } from '../types'
import { fetchPublicState } from '../lib/api'
import { demoLobbyState } from '../lib/demo-state'

export function mergePublicSnapshot(current: PublicEventState, next: PublicEventState) {
  if (next.stateVersion > current.stateVersion) return next
  // Counts change without a state-version bump. Never regress the phase/result
  // (including an operator's confirmed transition) to an older cached snapshot.
  if (next.stateVersion === current.stateVersion && next.round?.id === current.round?.id &&
    Date.parse(next.serverPublishedAt) > Date.parse(current.serverPublishedAt)) {
    return { ...current, registeredCount: next.registeredCount, submittedCount: next.submittedCount, serverPublishedAt: next.serverPublishedAt }
  }
  return current
}

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
  const inFlightRef = useRef<Promise<void> | null>(null)
  const lastFetchedRef = useRef<PublicEventState | null>(null)
  const timerRef = useRef<number | null>(null)
  const failureRef = useRef(0)
  const optionsRef = useRef(options)
  const hydratedRef = useRef(false)
  optionsRef.current = options

  const refresh = useCallback((): Promise<void> => {
    if (demo || document.hidden || optionsRef.current.timingCritical) return Promise.resolve()
    if (inFlightRef.current) return inFlightRef.current
    const controller = new AbortController()
    requestRef.current = controller
    const pending = (async () => {
      try {
        const next = await fetchPublicState(controller.signal)
        lastFetchedRef.current = next
        const firstSnapshot = !hydratedRef.current
        setState((current) => {
          if (firstSnapshot) return next
          return mergePublicSnapshot(current, next)
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
        inFlightRef.current = null
      }
    })()
    inFlightRef.current = pending
    return pending
  }, [demo])

  const refreshAtTaifReveal = useCallback(async (roundId: string) => {
    if (inFlightRef.current) await inFlightRef.current
    const latest = lastFetchedRef.current
    if (latest?.round?.id === roundId && latest.taifWinners.length === 4) return
    await refresh()
  }, [refresh])

  useEffect(() => {
    if (demo || options.active === false || options.timingCritical) return
    let stopped = false
    const schedule = () => {
      if (stopped || document.hidden) return
      timerRef.current = window.setTimeout(async () => {
        await refresh()
        schedule()
      }, pollingDelay({
        ...optionsRef.current,
        phase: lastFetchedRef.current?.phase ?? optionsRef.current.phase,
        taifReady: optionsRef.current.taifReady ||
          (lastFetchedRef.current?.currentGame === 'taif' && lastFetchedRef.current.round?.phase === 'active'),
      }, failureRef.current))
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

  return { state, error, refresh, refreshAtTaifReveal, setState }
}

export function useTaifRevealRefresh(roundId: string | null, refresh: (roundId: string) => Promise<void>) {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(() => {
    if (!roundId) return
    const timer = window.setTimeout(() => { void refreshRef.current(roundId) }, Math.random() * 300)
    return () => window.clearTimeout(timer)
  }, [roundId])
}
