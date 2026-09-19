import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

export function Button({ className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={'button ' + className} {...props}>{children}</button>
}

export function Card({ className = '', children, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <div className={'card ' + className} {...props}>{children}</div>
}

export function Metric({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return <div className={'metric ' + (accent ? 'accent' : '')}><span>{label}</span><strong>{value}</strong></div>
}

export function StatusPill({ children, tone = 'aqua' }: { children: ReactNode; tone?: 'aqua' | 'gold' | 'muted' }) {
  return <span className={'status-pill ' + tone}>{children}</span>
}
