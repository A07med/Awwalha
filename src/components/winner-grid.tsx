import { Crown } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import type { PublicWinner } from '../types'

export function WinnerGrid({ winners, game }: { winners: PublicWinner[]; game: 'perfect_second' | 'first_look' }) {
  const [page, setPage] = useState(0)
  const pages = Math.ceil(winners.length / 6)
  const winnerKey = winners.map(winner => winner.participantPublicId).join(',')
  useEffect(() => {
    setPage(0)
    if (pages <= 1) return
    const timer = window.setInterval(() => setPage(current => (current + 1) % pages), 8000)
    return () => window.clearInterval(timer)
  }, [pages, winnerKey])
  const offset = pages > 1 ? (page % pages) * 6 : 0
  const visible = winners.slice(offset, offset + 6)
  return <><div className={'winner-grid winner-reveal winners-' + visible.length}>
    {visible.map((winner, localIndex) => { const index = offset + localIndex; return <article className={'winner-card reveal-card ' + (localIndex === 0 ? 'first-place' : '')} key={winner.participantPublicId} style={{ '--reveal-delay': `${localIndex * 100}ms` } as CSSProperties} aria-label={'المركز ' + (index + 1)}>
      <div className="reveal-medal"><Crown aria-hidden="true" /><span className="reveal-rank">{['١', '٢', '٣', '٤', '٥', '٦'][index] ?? index + 1}</span></div>
      <h3>{winner.displayName}</h3>
      {game === 'perfect_second'
        ? <div className="reveal-timing"><span>{(winner.signedDeltaMs ?? 0) < 0 ? 'قبل الوقت المستهدف بـ' : (winner.signedDeltaMs ?? 0) > 0 ? 'بعد الوقت المستهدف بـ' : 'مطابق تمامًا'}</span><strong><b dir="ltr">{(Math.abs(winner.signedDeltaMs ?? 0) / 1000).toFixed(3)}</b> ثانية</strong></div>
        : <div className="reveal-answer"><div><span>إجابته</span><strong>{winner.guess ?? '—'}</strong></div><div><span>الفارق</span><strong>{winner.score}</strong></div></div>}
    </article> })}
  </div>{pages > 1 && <p className="winner-page-counter" aria-live="polite">الفائزون: {winners.length} · الصفحة {page % pages + 1} من {pages}</p>}</>
}
