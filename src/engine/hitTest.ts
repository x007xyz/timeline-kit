import type { TimelineDocument } from '../model/types'
import type { LayoutTrack, TimelineLayoutSnapshot } from './layout'
import { pxToMs } from './timeScale'

export type HitZone
  = | 'clip-body'
    | 'trim-start'
    | 'trim-end'
    | 'ruler'
    | 'playhead'
    | 'track-empty'
    | 'sidebar'
    | 'toolbar'
    | 'outside'

export interface TimelineHitTarget {
  zone: HitZone
  timeMs: number
  frame: number
  x: number
  y: number
  trackIndex: number
  clipIndex: number
  clipId: string | null
}

export interface HitTestOptions {
  x: number
  y: number
  trimHandleWidthPx?: number
  minClipWidthPx?: number
  zoneHint?: HitZone
  hintClipId?: string | null
  hintTrackIndex?: number
}

function findTrackByY(tracks: readonly LayoutTrack[], y: number): LayoutTrack | null {
  for (const track of tracks) {
    if (y >= track.startY && y <= track.endY) {
      return track
    }
  }
  return null
}

export function hitTestLayout(
  layout: TimelineLayoutSnapshot,
  doc: TimelineDocument,
  options: HitTestOptions,
): TimelineHitTarget {
  const safeX = Math.max(0, options.x)
  const timeMs = Math.max(0, Math.round(pxToMs(safeX, layout.pixelsPerSecond)))
  const frame = layout.fps > 0 ? Math.max(0, Math.round((timeMs / 1000) * layout.fps)) : 0
  const trimHandleWidthPx = options.trimHandleWidthPx ?? 8
  const minClipWidthPx = options.minClipWidthPx ?? 32

  if (options.zoneHint === 'playhead' || options.zoneHint === 'ruler' || options.zoneHint === 'toolbar' || options.zoneHint === 'sidebar' || options.zoneHint === 'outside') {
    return {
      zone: options.zoneHint,
      timeMs,
      frame,
      x: safeX,
      y: options.y,
      trackIndex: options.hintTrackIndex ?? -1,
      clipIndex: -1,
      clipId: null,
    }
  }

  if (options.hintClipId && (options.zoneHint === 'trim-start' || options.zoneHint === 'trim-end' || options.zoneHint === 'clip-body')) {
    for (let trackIndex = 0; trackIndex < doc.tracks.length; trackIndex += 1) {
      const track = doc.tracks[trackIndex]
      const clipIndex = track.clips.findIndex(clip => clip.id === options.hintClipId)
      if (clipIndex !== -1) {
        return {
          zone: options.zoneHint,
          timeMs,
          frame,
          x: safeX,
          y: options.y,
          trackIndex,
          clipIndex,
          clipId: options.hintClipId,
        }
      }
    }
  }

  const layoutTrack = findTrackByY(layout.tracks, options.y)
  if (!layoutTrack) {
    return {
      zone: 'track-empty',
      timeMs,
      frame,
      x: safeX,
      y: options.y,
      trackIndex: -1,
      clipIndex: -1,
      clipId: null,
    }
  }

  for (let index = layoutTrack.clips.length - 1; index >= 0; index -= 1) {
    const layoutClip = layoutTrack.clips[index]
    const clipLeft = layoutClip.leftPx
    const clipWidth = Math.max(layoutClip.widthPx, minClipWidthPx)
    const clipRight = clipLeft + clipWidth

    if (options.x >= clipLeft - trimHandleWidthPx && options.x <= clipLeft + trimHandleWidthPx / 2) {
      return {
        zone: 'trim-start',
        timeMs,
        frame,
        x: safeX,
        y: options.y,
        trackIndex: layoutClip.trackIndex,
        clipIndex: layoutClip.clipIndex,
        clipId: layoutClip.clip.id,
      }
    }

    if (options.x >= clipRight - trimHandleWidthPx / 2 && options.x <= clipRight + trimHandleWidthPx) {
      return {
        zone: 'trim-end',
        timeMs,
        frame,
        x: safeX,
        y: options.y,
        trackIndex: layoutClip.trackIndex,
        clipIndex: layoutClip.clipIndex,
        clipId: layoutClip.clip.id,
      }
    }

    if (options.x >= clipLeft && options.x <= clipRight) {
      return {
        zone: 'clip-body',
        timeMs,
        frame,
        x: safeX,
        y: options.y,
        trackIndex: layoutClip.trackIndex,
        clipIndex: layoutClip.clipIndex,
        clipId: layoutClip.clip.id,
      }
    }
  }

  return {
    zone: 'track-empty',
    timeMs,
    frame,
    x: safeX,
    y: options.y,
    trackIndex: layoutTrack.trackIndex,
    clipIndex: -1,
    clipId: null,
  }
}
