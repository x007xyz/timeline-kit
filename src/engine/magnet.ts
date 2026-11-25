import type { TimelineClip, TimelineTrack } from '../model/types'
import type { LayoutTrack } from './layout'

export interface MagnetAffectedClip {
  clipId: string
  originalStartMs: number
  originalEndMs: number
  newStartMs: number
  newEndMs: number
}

export interface TimelineMagnetState {
  isEnabled: boolean
  targetTrackIndex: number
  insertPosition: number
  dragClipDurationMs: number
  affectedClips: MagnetAffectedClip[]
  previewArrangement: TimelineClip[]
}

export interface MagnetPreviewTransform {
  clipId: string
  offsetX: number
}

export interface MagnetDetectionResult {
  magnetState?: TimelineMagnetState
  isMagnetMode: boolean
  reason?: 'new-track' | 'invalid-track' | 'non-magnet-track' | 'magnet-disabled'
}

export function isMagnetTrack(track: TimelineTrack | undefined, magnetEnabled: boolean): boolean {
  return Boolean(track?.main === true && magnetEnabled)
}

export function calculateMagnetArrangement(
  track: TimelineTrack,
  dragClipStartMs: number,
  dragClipDurationMs: number,
  cursorX: number,
  targetTrackLayout?: Pick<LayoutTrack, 'clips'>,
  excludeClipId?: string,
): {
  insertPosition: number
  newArrangement: TimelineClip[]
  affectedClips: MagnetAffectedClip[]
} {
  const existingClips = track.clips
    .filter(clip => clip.id !== excludeClipId)
    .sort((left, right) => left.startMs - right.startMs)

  let insertPosition = 0

  if (targetTrackLayout?.clips.length) {
    for (let index = 0; index < existingClips.length; index += 1) {
      const clip = existingClips[index]
      const clipLayout = targetTrackLayout.clips.find(item => item.clip.id === clip.id)
      if (!clipLayout) {
        continue
      }

      const clipStartX = clipLayout.leftPx
      const clipEndX = clipLayout.leftPx + clipLayout.widthPx
      const clipMidX = (clipStartX + clipEndX) / 2

      if (cursorX >= clipStartX && cursorX <= clipEndX) {
        insertPosition = cursorX <= clipMidX ? index : index + 1
        break
      }

      if (cursorX < clipStartX) {
        insertPosition = index
        break
      }

      insertPosition = index + 1
    }
  }
  else {
    for (let index = 0; index < existingClips.length; index += 1) {
      const clip = existingClips[index]
      const clipMidTime = (clip.startMs + clip.endMs) / 2

      if (dragClipStartMs >= clip.startMs && dragClipStartMs <= clip.endMs) {
        insertPosition = dragClipStartMs <= clipMidTime ? index : index + 1
        break
      }

      if (dragClipStartMs < clip.startMs) {
        insertPosition = index
        break
      }

      insertPosition = index + 1
    }
  }

  const newArrangement: TimelineClip[] = []
  const affectedClips: MagnetAffectedClip[] = []
  let currentTimeMs = 0

  for (let index = 0; index < insertPosition; index += 1) {
    const clip = existingClips[index]
    const durationMs = Math.max(0, clip.endMs - clip.startMs)
    newArrangement.push({
      ...clip,
      startMs: currentTimeMs,
      endMs: currentTimeMs + durationMs,
    })

    if (clip.startMs !== currentTimeMs) {
      affectedClips.push({
        clipId: clip.id,
        originalStartMs: clip.startMs,
        originalEndMs: clip.endMs,
        newStartMs: currentTimeMs,
        newEndMs: currentTimeMs + durationMs,
      })
    }

    currentTimeMs += durationMs
  }

  currentTimeMs += Math.max(0, dragClipDurationMs)

  for (let index = insertPosition; index < existingClips.length; index += 1) {
    const clip = existingClips[index]
    const durationMs = Math.max(0, clip.endMs - clip.startMs)
    newArrangement.push({
      ...clip,
      startMs: currentTimeMs,
      endMs: currentTimeMs + durationMs,
    })

    if (clip.startMs !== currentTimeMs) {
      affectedClips.push({
        clipId: clip.id,
        originalStartMs: clip.startMs,
        originalEndMs: clip.endMs,
        newStartMs: currentTimeMs,
        newEndMs: currentTimeMs + durationMs,
      })
    }

    currentTimeMs += durationMs
  }

  return {
    insertPosition,
    newArrangement,
    affectedClips,
  }
}

export function detectMagnetState(options: {
  tracks: readonly TimelineTrack[]
  tracksLayout: readonly (Pick<LayoutTrack, 'clips'> | undefined)[]
  targetTrackIndex: number
  isNewTrack: boolean
  targetX: number
  cursorX: number
  dragClipDurationMs: number
  sourceTrackIndex: number
  sourceClipId: string
  pixelToMs: (pixel: number) => number
  magnetEnabled: boolean
}): MagnetDetectionResult {
  if (options.isNewTrack) {
    return { isMagnetMode: false, reason: 'new-track' }
  }

  const targetTrack = options.tracks[options.targetTrackIndex]
  if (!targetTrack) {
    return { isMagnetMode: false, reason: 'invalid-track' }
  }

  if (!isMagnetTrack(targetTrack, options.magnetEnabled)) {
    return {
      isMagnetMode: false,
      reason: options.magnetEnabled ? 'non-magnet-track' : 'magnet-disabled',
    }
  }

  const dragClipStartMs = options.pixelToMs(options.targetX)
  const excludeClipId = options.sourceTrackIndex === options.targetTrackIndex
    ? options.sourceClipId
    : undefined

  const arrangement = calculateMagnetArrangement(
    targetTrack,
    dragClipStartMs,
    options.dragClipDurationMs,
    options.cursorX,
    options.tracksLayout[options.targetTrackIndex],
    excludeClipId,
  )

  return {
    isMagnetMode: true,
    magnetState: {
      isEnabled: true,
      targetTrackIndex: options.targetTrackIndex,
      insertPosition: arrangement.insertPosition,
      dragClipDurationMs: options.dragClipDurationMs,
      affectedClips: arrangement.affectedClips,
      previewArrangement: arrangement.newArrangement,
    },
  }
}

export function getMagnetPreviewTransforms(
  magnetState: TimelineMagnetState,
  dragClipId: string,
  msToPixel: (ms: number) => number,
  targetTrackLayout?: Pick<LayoutTrack, 'clips'>,
): MagnetPreviewTransform[] {
  if (!targetTrackLayout?.clips.length) {
    return []
  }

  const arranged: Array<{ id: string, startMs: number, isDragClip: boolean }> = []
  let currentTimeMs = 0

  for (let index = 0; index <= magnetState.previewArrangement.length; index += 1) {
    if (index === magnetState.insertPosition) {
      arranged.push({
        id: dragClipId,
        startMs: currentTimeMs,
        isDragClip: true,
      })
      currentTimeMs += magnetState.dragClipDurationMs
    }

    if (index < magnetState.previewArrangement.length) {
      const clip = magnetState.previewArrangement[index]
      const durationMs = Math.max(0, clip.endMs - clip.startMs)
      arranged.push({
        id: clip.id,
        startMs: currentTimeMs,
        isDragClip: false,
      })
      currentTimeMs += durationMs
    }
  }

  const transforms: MagnetPreviewTransform[] = []
  for (const item of arranged) {
    if (item.isDragClip) {
      continue
    }
    const originalLayout = targetTrackLayout.clips.find(layoutClip => layoutClip.clip.id === item.id)
    if (!originalLayout) {
      continue
    }
    transforms.push({
      clipId: item.id,
      offsetX: msToPixel(item.startMs) - originalLayout.leftPx,
    })
  }

  return transforms
}
