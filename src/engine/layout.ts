import type { TimelineClip, TimelineDocument, TimelineTrack } from '../model/types'
import { getDocumentDurationMs } from '../model/operations'
import { getFramePixel, getPixelsPerSecond, msToPx } from './timeScale'

export interface TrackLayoutConfigEntry {
  height?: number
}

export interface LayoutClip {
  clip: TimelineClip
  track: TimelineTrack
  trackIndex: number
  clipIndex: number
  type: string
  startMs: number
  endMs: number
  leftPx: number
  widthPx: number
}

export interface LayoutTrack {
  track: TimelineTrack
  trackIndex: number
  type: string
  height: number
  startY: number
  endY: number
  clips: LayoutClip[]
}

export interface TimelineLayoutSnapshot {
  fps: number
  trackScale: number
  framePixel: number
  pixelsPerSecond: number
  totalDurationMs: number
  totalDurationSec: number
  contentTop: number
  contentBottom: number
  contentHeight: number
  tracks: LayoutTrack[]
}

export const DEFAULT_TRACK_HEIGHT = 64
export const DEFAULT_TRACK_GAP = 4
export const DEFAULT_TRACK_PADDING_TOP = 20

export function getTrackHeight(config?: TrackLayoutConfigEntry): number {
  return typeof config?.height === 'number' && config.height > 0 ? config.height : DEFAULT_TRACK_HEIGHT
}

export function computeTimelineLayout(
  doc: TimelineDocument,
  options: {
    trackScale: number
    trackConfigs?: Record<string, TrackLayoutConfigEntry | undefined>
    viewportHeight?: number
    trackGap?: number
    paddingTop?: number
  },
): TimelineLayoutSnapshot {
  const fps = doc.fps > 0 ? doc.fps : 24
  const framePixel = getFramePixel(options.trackScale, fps)
  const pixelsPerSecond = getPixelsPerSecond(options.trackScale, fps)
  const trackGap = options.trackGap ?? DEFAULT_TRACK_GAP
  const paddingTop = options.paddingTop ?? DEFAULT_TRACK_PADDING_TOP
  const trackConfigs = options.trackConfigs ?? {}

  const trackHeights = doc.tracks.map(track => getTrackHeight(trackConfigs[track.type]))
  const totalTrackHeight = trackHeights.reduce((sum, height) => sum + height, 0)
  const totalGapHeight = Math.max(0, (trackHeights.length - 1) * trackGap)
  const totalRequiredHeight = totalTrackHeight + totalGapHeight
  const viewportHeight = options.viewportHeight ?? 0
  const centeredOffset = viewportHeight > 0 && totalRequiredHeight < viewportHeight
    ? Math.max(paddingTop, (viewportHeight - totalRequiredHeight) / 2)
    : paddingTop

  let currentY = centeredOffset
  const tracks: LayoutTrack[] = doc.tracks.map((track, trackIndex) => {
    const height = trackHeights[trackIndex]
    const clips: LayoutClip[] = track.clips.map((clip, clipIndex) => {
      const startMs = Math.max(0, clip.startMs)
      const endMs = Math.max(startMs, clip.endMs)
      const leftPx = msToPx(startMs, pixelsPerSecond)
      const widthPx = msToPx(endMs - startMs, pixelsPerSecond)

      return {
        clip,
        track,
        trackIndex,
        clipIndex,
        type: clip.type || track.type,
        startMs,
        endMs,
        leftPx,
        widthPx,
      }
    })

    const startY = currentY
    const endY = startY + height
    currentY = endY + trackGap

    return {
      track,
      trackIndex,
      type: track.type,
      height,
      startY,
      endY,
      clips,
    }
  })

  const totalDurationMs = getDocumentDurationMs(doc)
  const contentHeight = tracks.length > 0
    ? tracks[tracks.length - 1].endY + centeredOffset
    : centeredOffset * 2

  return {
    fps,
    trackScale: options.trackScale,
    framePixel,
    pixelsPerSecond,
    totalDurationMs,
    totalDurationSec: totalDurationMs / 1000,
    contentTop: centeredOffset,
    contentBottom: centeredOffset,
    contentHeight,
    tracks,
  }
}
