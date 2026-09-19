import { Crown } from 'lucide-react'
import type { PublicWinner } from '../types'

export function WinnerGrid({ winners, game }: { winners: PublicWinner[]; game: 'perfect_second' | 'first_look' }) {
  return <div className={'winner-grid winners-' + winners.length}>
    {winners.map((winner, index) => <article className="winner-card" key={winner.participantPublicId}>
      <span className="winner-rank"><Crown size={20} /> {index + 1}</span>
      <h3>{winner.displayName}</h3>
      {game === 'perfect_second'
        ? <strong dir="ltr">{(winner.signedDeltaMs ?? 0) >= 0 ? '+' : ''}{((winner.signedDeltaMs ?? 0) / 1000).toFixed(3)}s</strong>
        : <strong>الإجابة {winner.guess} · الفرق {winner.score}</strong>}
    </article>)}
  </div>
}
