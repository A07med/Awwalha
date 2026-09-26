import type { ReactNode } from 'react'
import { Clock3, Eye } from 'lucide-react'
import { Wordmark } from './brand'
import { TaifMark } from './taif-mark'
import type { GameType } from '../types'

export const stageNames = { perfect_second: 'الثانية المثالية', first_look: 'أول نظرة', taif: 'وَهَج' }
export function StageMark({ game }: { game: GameType }) {
  return <div className={'projector-mark mark-' + game} aria-hidden="true">{game === 'perfect_second' ? <Clock3 /> : game === 'first_look' ? <Eye /> : <TaifMark />}</div>
}
export function Projector({ game, phase, children, registered, submitted, metric }: {
  game: GameType; phase: string; children: ReactNode; registered?: number; submitted?: number; metric?: string
}) {
  return <main className={'projector projector-' + game} data-stage-phase={phase} dir="rtl">
    <header className="projector-header"><Wordmark /><span className="projector-badge">{stageNames[game]}</span></header>
    <section className="projector-canvas">{children}</section>
    {registered !== undefined && <footer className="projector-rail"><span>{registered} مشارك</span><i aria-hidden="true" /><span>{submitted ?? 0} {metric}</span></footer>}
  </main>
}
export function StageWaiting({ game, phase, error }: { game: GameType; phase: string; error?: boolean }) {
  return <div className="projector-message"><StageMark game={game} /><h1>{stageNames[game]}</h1><p>{error ? 'تعذر تحميل عرض الجولة' : phase === 'loading' ? 'جاري تجهيز المسرح' : phase === 'closed' || phase === 'revealed' ? 'جاري حساب النتيجة' : 'بانتظار بدء الجولة'}</p>{phase === 'closed' && <span className="projector-kicker">تم إغلاق الجولة</span>}</div>
}
export function StageCountdown({ elapsedMs }: { elapsedMs: number }) {
  return <div className="projector-countdown"><span>استعد</span><strong dir="ltr">{Math.ceil(-elapsedMs / 1000)}</strong></div>
}
