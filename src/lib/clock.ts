import type { ClockSample } from '../types'

export function calculateClockSample(clientSentEpoch: number, clientReceivedEpoch: number, serverEpoch: number): ClockSample {
  const rttMs = Math.max(0, clientReceivedEpoch - clientSentEpoch)
  const midpoint = clientSentEpoch + rttMs / 2
  return { offsetMs: serverEpoch - midpoint, rttMs, measuredAt: clientReceivedEpoch }
}

export function chooseBestClockSample(samples: ClockSample[]): ClockSample | null {
  if (!samples.length) return null
  return samples.reduce((best, item) => item.rttMs < best.rttMs ? item : best)
}

export function serverEpochToPerformance(serverEpoch: number, offsetMs: number, nowEpoch = Date.now(), nowPerformance = performance.now()) {
  const localEpoch = serverEpoch - offsetMs
  return nowPerformance + (localEpoch - nowEpoch)
}

export async function syncClock(sampleCount = 3, signal?: AbortSignal): Promise<ClockSample> {
  const samples: ClockSample[] = []
  for (let index = 0; index < sampleCount; index += 1) {
    if (index) await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, 120 + Math.random() * 280)
      signal?.addEventListener('abort', () => { window.clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
    })
    const sent = Date.now()
    const response = await fetch('/api/time', { cache: 'no-store', signal })
    if (!response.ok) throw new Error('تعذر ضبط الوقت')
    const payload = await response.json() as { epochMs: number }
    const received = Date.now()
    samples.push(calculateClockSample(sent, received, payload.epochMs))
  }
  return chooseBestClockSample(samples) as ClockSample
}
