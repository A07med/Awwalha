import type { ReactNode } from 'react'
import { AmbientBackground, Wordmark } from './brand'

export function PageShell({ children, className = '', header = true }: { children: ReactNode; className?: string; header?: boolean }) {
  return (
    <main className={'page-shell ' + className} dir="rtl">
      <AmbientBackground />
      {header && <header className="site-header"><Wordmark compact /><span>مساحة للحظات التي تُحكى</span></header>}
      <div className="page-content">{children}</div>
    </main>
  )
}
