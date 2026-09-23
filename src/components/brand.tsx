export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="wordmark" aria-label="أولها">
      <img className="wordmark-mark" src="/awwalha-mark.svg" alt="" aria-hidden="true" width="48" height="48" />
      <span className={compact ? 'wordmark-text small' : 'wordmark-text'}>أولها</span>
      {!compact && <span className="wordmark-en">AWWALHA · LIVE</span>}
    </div>
  )
}

export function AmbientBackground() {
  return <div className="ambient" aria-hidden="true"><span /><span /><span /></div>
}
