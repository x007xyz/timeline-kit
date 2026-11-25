import type { Clip, Track } from '../types'
import { isGap } from '../guards'
import { getTrackDurationSeconds } from '../selectors/timeline'
import { getTrackItemOffsets } from '../selectors/track'
import { cloneTrack, createGapLike, mergeAdjacentGaps } from './helpers'
import { createGap } from './create'

export function insertClipWithGap(track: Track, clip: Clip, atSeconds: number, fps: number): Track {
  const next = cloneTrack(track)
  const clipDurationFrames = clip.source_range.duration.value
  const clipDurationSeconds = clipDurationFrames / fps
  const timelineDurationSeconds = getTrackDurationSeconds(next)

  if (atSeconds >= timelineDurationSeconds) {
    const gapSeconds = atSeconds - timelineDurationSeconds
    if (gapSeconds > 0) {
      next.children.push(createGap('Gap', Math.round(gapSeconds * fps), fps))
    }
    next.children.push(clip)
    return {
      ...next,
      children: mergeAdjacentGaps(next.children),
    }
  }

  const offsets = getTrackItemOffsets(next)
  const insertionPoint = offsets.find(offset => atSeconds >= offset.start && atSeconds <= offset.end)

  if (!insertionPoint) {
    throw new Error('Failed to resolve insertion point')
  }

  if (!isGap(insertionPoint.item)) {
    throw new Error('Cannot insert clip into occupied range without explicit ripple command')
  }

  const gap = insertionPoint.item
  const gapStartFrames = Math.round((atSeconds - insertionPoint.start) * fps)
  const gapDurationFrames = gap.source_range.duration.value
  const gapEndFrames = gapDurationFrames - gapStartFrames

  if (clipDurationFrames > gapEndFrames) {
    throw new Error('Target gap is too small for clip insertion')
  }

  const index = next.children.findIndex(item => item.id === gap.id)
  const replacement = []

  if (gapStartFrames > 0) {
    replacement.push(createGapLike(gap, gapStartFrames))
  }

  replacement.push(clip)

  const remainingGapFrames = gapEndFrames - clipDurationFrames
  if (remainingGapFrames > 0) {
    replacement.push(createGapLike(gap, remainingGapFrames))
  }

  next.children.splice(index, 1, ...replacement)
  return {
    ...next,
    children: mergeAdjacentGaps(next.children),
  }
}
