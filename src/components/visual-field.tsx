import { Droplets, Fish, Leaf, Sprout } from 'lucide-react'
import type { CSSProperties } from 'react'
import { generatePackedPositions } from '../lib/visuals'

const icons = {
  seeds: Sprout,
  leaves: Leaf,
  fish: Fish,
  bubbles: Droplets,
  drops: Droplets,
}

export function VisualField({ seed, count, category = 'leaves', hidden = false, projector = false }: { seed: number; count: number; category?: keyof typeof icons; hidden?: boolean; projector?: boolean }) {
  const Icon = icons[category]
  const points = generatePackedPositions(seed, count)
  const columns = Math.ceil(Math.sqrt(count * 1.55))
  const rows = Math.ceil(count / columns)
  const displayPoints = projector ? points.map((point, index) => {
    const row = Math.floor(index / columns)
    const column = index % columns
    const usedColumns = Math.min(columns, count - row * columns)
    const cx = 100 / columns * (column + .5)
    const cy = 100 / rows * (row + .5)
    return { ...point, x: cx + (point.x - cx) * .45 + (columns - usedColumns) * 50 / columns, y: cy + (point.y - cy) * .5 }
  }) : points
  return (
    <div className={'visual-field ' + (hidden ? 'visual-hidden' : '')} style={{ '--visual-columns': columns, '--visual-rows': Math.ceil(count / columns) } as CSSProperties} aria-label={hidden ? 'انتهى العرض' : 'مجموعة عناصر للعد'}>
      {displayPoints.map((point) => (
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
