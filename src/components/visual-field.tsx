import { Droplets, Fish, Leaf, Sprout } from 'lucide-react'
import { generatePackedPositions } from '../lib/visuals'

const icons = {
  seeds: Sprout,
  leaves: Leaf,
  fish: Fish,
  bubbles: Droplets,
  drops: Droplets,
}

export function VisualField({ seed, count, category = 'leaves', hidden = false }: { seed: number; count: number; category?: keyof typeof icons; hidden?: boolean }) {
  const Icon = icons[category]
  const points = generatePackedPositions(seed, count)
  return (
    <div className={'visual-field ' + (hidden ? 'visual-hidden' : '')} aria-label={hidden ? 'انتهى العرض' : 'مجموعة عناصر للعد'}>
      {points.map((point) => (
        <Icon
          key={point.id}
          className="visual-item"
          style={{ left: point.x + '%', top: point.y + '%', transform: 'translate(-50%, -50%) rotate(' + point.rotation + 'deg) scale(' + point.scale + ')' }}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}
