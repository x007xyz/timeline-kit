import type { SnapProvider, SnapPoint } from '../engine/snap'
import { frameToMs, msToPx, pxToMs } from '../engine/timeScale'

export const playheadSnapProvider: SnapProvider = {
  id: 'builtin:playhead',
  getSnapPoints(ctx) {
    const timeMs = frameToMs(ctx.currentFrame, ctx.layout.fps)
    return [
      {
        timeMs,
        x: msToPx(timeMs, ctx.layout.pixelsPerSecond),
        source: 'playhead',
        kind: 'playhead',
      },
    ]
  },
}

export const clipEdgeSnapProvider: SnapProvider = {
  id: 'builtin:clip-edges',
  getSnapPoints(ctx) {
    const points: SnapPoint[] = []
    for (const track of ctx.layout.tracks) {
      for (const clipLayout of track.clips) {
        if (ctx.excludeClipIds.has(clipLayout.clip.id)) {
          continue
        }
        points.push({
          timeMs: clipLayout.startMs,
          x: clipLayout.leftPx,
          source: 'clip-edge',
          clipId: clipLayout.clip.id,
          kind: 'start',
        })
        points.push({
          timeMs: clipLayout.endMs,
          x: clipLayout.leftPx + clipLayout.widthPx,
          source: 'clip-edge',
          clipId: clipLayout.clip.id,
          kind: 'end',
        })
      }
    }
    return points
  },
}

export interface GridSnapProviderOptions {
  stepMs?: number
  enabled?: () => boolean
  radiusSteps?: number
}

export function createGridSnapProvider(options: GridSnapProviderOptions = {}): SnapProvider {
  const stepMs = Math.max(10, options.stepMs ?? 500)
  const radiusSteps = Math.max(1, options.radiusSteps ?? 2)

  return {
    id: 'builtin:grid',
    getSnapPoints(ctx) {
      if (options.enabled && !options.enabled()) {
        return []
      }

      const approxStartMs = pxToMs(ctx.targetLeftPx, ctx.layout.pixelsPerSecond)
      const approxEndMs = approxStartMs + ctx.durationMs
      const candidates = new Set<number>()

      const addNearbyGrid = (targetMs: number) => {
        const nearestStep = Math.round(targetMs / stepMs)
        for (let offset = -radiusSteps; offset <= radiusSteps; offset += 1) {
          const timeMs = Math.max(0, (nearestStep + offset) * stepMs)
          candidates.add(timeMs)
        }
      }

      addNearbyGrid(approxStartMs)
      addNearbyGrid(approxEndMs)

      const points: SnapPoint[] = []
      for (const timeMs of candidates) {
        points.push({
          timeMs,
          x: msToPx(timeMs, ctx.layout.pixelsPerSecond),
          source: 'grid',
          kind: 'grid',
        })
      }
      return points
    },
  }
}
