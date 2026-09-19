export interface VisualPoint { id: number; x: number; y: number; rotation: number; scale: number }

function mulberry32(seed: number) {
  return () => {
    let t = seed += 0x6d2b79f5
    t = Math.imul(t ^ t >>> 15, t | 1)
    t ^= t + Math.imul(t ^ t >>> 7, t | 61)
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

export function generatePackedPositions(seed: number, count: number): VisualPoint[] {
  const random = mulberry32(seed)
  const columns = Math.ceil(Math.sqrt(count * 1.55))
  const rows = Math.ceil(count / columns)
  const points: VisualPoint[] = []
  for (let index = 0; index < count; index += 1) {
    const column = index % columns
    const row = Math.floor(index / columns)
    const cellWidth = 100 / columns
    const cellHeight = 100 / rows
    points.push({
      id: index,
      x: cellWidth * (column + 0.5) + (random() - 0.5) * cellWidth * 0.44,
      y: cellHeight * (row + 0.5) + (random() - 0.5) * cellHeight * 0.38,
      rotation: Math.round((random() - 0.5) * 42),
      scale: 0.82 + random() * 0.28,
    })
  }
  return points
}
