import type { TimelineLayoutSnapshot } from './layout'
import { msToPx, pxToMs } from './timeScale'

export interface SnapPoint {
  timeMs: number
  x: number
  source: string
  clipId?: string
  kind?: 'start' | 'end' | 'playhead' | 'grid' | 'custom'
}

export interface SnapContext {
  layout: TimelineLayoutSnapshot
  currentFrame: number
  excludeClipIds: ReadonlySet<string>
  targetLeftPx: number
  durationMs: number
}

export interface SnapProvider {
  id: string
  getSnapPoints: (ctx: SnapContext) => SnapPoint[]
}

export interface SnapResult {
  leftPx: number
  startMs: number
  guidelineX: number
  point: SnapPoint
  edge: 'start' | 'end'
}

export function collectSnapPoints(
  providers: readonly SnapProvider[],
  ctx: SnapContext,
): SnapPoint[] {
  const points: SnapPoint[] = [
    {
      timeMs: 0,
      x: 0,
      source: 'timeline-start',
      kind: 'start',
    },
  ]

  for (const provider of providers) {
    const supplied = provider.getSnapPoints(ctx)
    for (const point of supplied) {
      points.push(point)
    }
  }

  return points
}

export function findBestSnap(
  targetLeftPx: number,
  durationMs: number,
  points: readonly SnapPoint[],
  pixelsPerSecond: number,
  thresholdPx: number = 10,
): SnapResult | null {
  const durationPx = msToPx(Math.max(0, durationMs), pixelsPerSecond)
  const targetRightPx = targetLeftPx + durationPx

  let best: SnapResult | null = null
  let minDistance = thresholdPx

  for (const point of points) {
    const startDistance = Math.abs(targetLeftPx - point.x)
    if (startDistance < minDistance) {
      minDistance = startDistance
      best = {
        leftPx: Math.max(0, point.x),
        startMs: Math.max(0, point.timeMs),
        guidelineX: point.x,
        point,
        edge: 'start',
      }
    }

    const endDistance = Math.abs(targetRightPx - point.x)
    if (endDistance < minDistance) {
      const snappedLeftPx = point.x - durationPx
      if (snappedLeftPx >= -0.001) {
        const clampedLeftPx = Math.max(0, snappedLeftPx)
        minDistance = endDistance
        best = {
          leftPx: clampedLeftPx,
          startMs: Math.max(0, Math.round(pxToMs(clampedLeftPx, pixelsPerSecond))),
          guidelineX: point.x,
          point,
          edge: 'end',
        }
      }
    }
  }

  return best
}
