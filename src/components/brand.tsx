import { Waves } from 'lucide-react'

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="wordmark" aria-label="أولها">
      <span className="wordmark-mark"><Waves size={compact ? 18 : 24} strokeWidth={1.8} /></span>
      <span className={compact ? 'wordmark-text small' : 'wordmark-text'}>أولها</span>
      {!compact && <span className="wordmark-en">AWWALHA LIVE</span>}
    </div>
  )
}

export function AmbientBackground() {
  return <div className="ambient" aria-hidden="true"><span /><span /><span /></div>
}
