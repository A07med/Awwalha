import { useEffect, useRef, useState } from 'react'
import type { ParticipantSession, PublicEventState, TaifColor } from '../types'
import { joinTaifRound } from '../lib/api'
import logoUrl from '../assets/awwalha-logo.svg'

type ReadyStatus = 'idle' | 'submitting' | 'ready' | 'failed'

function readyStorageKey(roundId: string, participantPublicId: string) {
  return `awwalha.taif.ready.v1.${roundId}.${participantPublicId}`
}

export function taifFinalColor(state: PublicEventState, participantPublicId: string): TaifColor | 'white' {
  return state.taifWinners.find((winner) => winner.participantPublicId === participantPublicId)?.color ?? 'white'
}

export function TaifScreen({ state, session, elapsedMs, onReadyChange }: { state: PublicEventState; session: ParticipantSession; elapsedMs: number; onReadyChange: (ready: boolean) => void }) {
  const round = state.round!
  const key = readyStorageKey(round.id, session.participantPublicId)
  const [status, setStatus] = useState<ReadyStatus>(() => sessionStorage.getItem(key) === 'ready' ? 'ready' : 'idle')
  const lockedRef = useRef(status !== 'idle')

  useEffect(() => {
    const ready = sessionStorage.getItem(key) === 'ready'
    lockedRef.current = ready
    setStatus(ready ? 'ready' : 'idle')
    onReadyChange(ready)
  }, [key, onReadyChange])

  async function ready() {
    if (lockedRef.current || round.phase !== 'preparing') return
    lockedRef.current = true
    setStatus('submitting')
    try {
      if (import.meta.env.VITE_APP_MODE === 'supabase') await joinTaifRound(session.token, round.id)
      sessionStorage.setItem(key, 'ready')
      setStatus('ready')
      onReadyChange(true)
    } catch {
      lockedRef.current = false
      setStatus('failed')
    }
  }

  const revealElapsedMs = round.revealAt && round.startsAt ? Date.parse(round.revealAt) - Date.parse(round.startsAt) : 6000
  if (round.phase === 'active' && elapsedMs >= 0) {
    const revealed = elapsedMs >= revealElapsedMs && state.taifWinners.length === 4
    const color = revealed ? taifFinalColor(state, session.participantPublicId) : null
    return <main
      className={`taif-viewport ${revealed ? `taif-result taif-${color}` : 'taif-active'}`}
      data-taif-phase={revealed ? 'revealed' : 'active'}
      data-taif-color={color ?? undefined}
      aria-label={revealed ? 'نتيجة وَهَج' : 'ألوان وَهَج'}
    />
  }

  const rosterLocked = round.phase !== 'preparing'
  return <main className="taif-ready-screen" data-taif-ready={rosterLocked ? 'locked' : status}>
    <img className="taif-ready-brand" src={logoUrl} alt="أولها" />
    {!rosterLocked && (status === 'idle' || status === 'failed')
      ? <button type="button" className="taif-ready-button" onPointerDown={() => void ready()} onClick={() => void ready()}>مستعد</button>
      : <span className="taif-ready-pulse" aria-label="جاهز" />}
  </main>
}
