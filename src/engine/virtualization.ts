import type { LayoutClip } from './layout'
import { pxToMs } from './timeScale'

export interface VisibleTimeRange {
  startMs: number
  endMs: number
  startPx: number
  endPx: number
}

export const DEFAULT_OVERSCAN_PX = 240

export function computeVisibleRange(
  scrollLeft: number,
  viewportWidth: number,
  pixelsPerSecond: number,
  paddingLeft: number = 0,
  overscanPx: number = DEFAULT_OVERSCAN_PX,
): VisibleTimeRange {
  const safeWidth = Math.max(0, viewportWidth)
  const startPx = Math.max(0, scrollLeft - paddingLeft - overscanPx)
  const endPx = Math.max(startPx, scrollLeft - paddingLeft + safeWidth + overscanPx)

  return {
    startPx,
    endPx,
    startMs: pxToMs(startPx, pixelsPerSecond),
    endMs: pxToMs(endPx, pixelsPerSecond),
  }
}

export function isClipInVisibleRange(
  clip: Pick<LayoutClip, 'startMs' | 'endMs'>,
  range: VisibleTimeRange,
): boolean {
  return clip.endMs >= range.startMs && clip.startMs <= range.endMs
}

export function filterVisibleClips(
  clips: readonly LayoutClip[],
  range: VisibleTimeRange,
  alwaysIncludeIds?: ReadonlySet<string>,
): LayoutClip[] {
  return clips.filter((clipLayout) => {
    if (alwaysIncludeIds?.has(clipLayout.clip.id)) {
      return true
    }
    return isClipInVisibleRange(clipLayout, range)
  })
}
