import logoUrl from '../assets/awwalha-logo.svg'

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="wordmark" aria-label="أولها">
      <img className={compact ? 'wordmark-image compact' : 'wordmark-image'} src={logoUrl} alt="" aria-hidden="true" width="310" height="145" />
    </div>
  )
}

export function AmbientBackground() {
  return <div className="ambient" aria-hidden="true"><span /><span /><span /></div>
}
