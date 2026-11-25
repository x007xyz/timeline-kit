import { DEFAULT_EDIT_POLICIES, type EditPolicies, type TimelineClip, type TimelineTrack } from '../model/types'
import type { LayoutTrack } from './layout'
import { isMagnetTrack } from './magnet'

export interface PlacementTargetInfo {
  isNewTrack: boolean
  insertIndex: number
}

export function checkTrackOverlap(
  tracks: readonly TimelineTrack[],
  targetTrackIndex: number,
  startMs: number,
  endMs: number,
  excludeClipId?: string,
  policies: EditPolicies = DEFAULT_EDIT_POLICIES,
  magnetEnabled: boolean = false,
): boolean {
  if (policies.allowOverlap) {
    return false
  }

  const targetTrack = tracks[targetTrackIndex]
  if (!targetTrack || isMagnetTrack(targetTrack, magnetEnabled)) {
    return false
  }

  for (const clip of targetTrack.clips) {
    if (excludeClipId && clip.id === excludeClipId) {
      continue
    }
    if (startMs < clip.endMs && endMs > clip.startMs) {
      return true
    }
  }

  return false
}

export function resolveTargetTrack(
  tracks: readonly TimelineTrack[],
  tracksLayout: readonly Pick<LayoutTrack, 'startY' | 'endY' | 'type'>[],
  y: number,
  dragClip: Pick<TimelineClip, 'id' | 'type' | 'startMs' | 'endMs'>,
  options: {
    targetStartMs: number
    sourceTrackIndex?: number
    magnetEnabled: boolean
    policies?: EditPolicies
  },
): PlacementTargetInfo {
  const policies = options.policies ?? DEFAULT_EDIT_POLICIES
  const clipDurationMs = Math.max(0, dragClip.endMs - dragClip.startMs)
  const targetStartMs = Math.max(0, options.targetStartMs)
  const targetEndMs = targetStartMs + clipDurationMs
  const sourceTrack = options.sourceTrackIndex !== undefined
    ? tracks[options.sourceTrackIndex]
    : undefined

  for (let index = 0; index < tracksLayout.length; index += 1) {
    const layoutTrack = tracksLayout[index]
    const actualTrack = tracks[index]
    if (!actualTrack) {
      continue
    }

    if (y < layoutTrack.startY || y > layoutTrack.endY) {
      continue
    }

    const midY = (layoutTrack.startY + layoutTrack.endY) / 2
    const newTrackFallback: PlacementTargetInfo = {
      isNewTrack: true,
      insertIndex: y < midY ? index : index + 1,
    }

    if (actualTrack.locked === true) {
      return newTrackFallback
    }

    if (!policies.allowCrossTrackType && layoutTrack.type !== dragClip.type) {
      return newTrackFallback
    }

    if (policies.canDrop && !policies.canDrop({
      clip: dragClip as TimelineClip,
      sourceTrack,
      targetTrack: actualTrack,
      startMs: targetStartMs,
      endMs: targetEndMs,
    })) {
      return newTrackFallback
    }

    if (isMagnetTrack(actualTrack, options.magnetEnabled)) {
      return { isNewTrack: false, insertIndex: index }
    }

    if (checkTrackOverlap(
      tracks,
      index,
      targetStartMs,
      targetEndMs,
      dragClip.id,
      policies,
      options.magnetEnabled,
    )) {
      return newTrackFallback
    }

    return { isNewTrack: false, insertIndex: index }
  }

  if (tracksLayout.length === 0 || y < tracksLayout[0].startY) {
    return { isNewTrack: true, insertIndex: 0 }
  }

  const lastTrack = tracksLayout[tracksLayout.length - 1]
  if (y > lastTrack.endY) {
    return { isNewTrack: true, insertIndex: tracksLayout.length }
  }

  for (let index = 0; index < tracksLayout.length - 1; index += 1) {
    if (y > tracksLayout[index].endY && y < tracksLayout[index + 1].startY) {
      return { isNewTrack: true, insertIndex: index + 1 }
    }
  }

  return { isNewTrack: true, insertIndex: tracksLayout.length }
}
