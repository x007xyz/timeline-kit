import type { Clip, Track } from '../types'
import { isClip } from '../guards'
import { cloneTrack } from './helpers'

function getClip(track: Track, clipId: string): Clip {
  const item = track.children.find(child => child.id === clipId)
  if (!item || !isClip(item)) {
    throw new Error(`Clip ${clipId} not found`)
  }
  return item
}

export function trimClipStart(track: Track, clipId: string, trimFrames: number): Track {
  const next = cloneTrack(track)
  const clip = getClip(next, clipId)

  if (trimFrames <= 0) {
    return next
  }

  if (trimFrames >= clip.source_range.duration.value) {
    throw new Error('Trim start exceeds clip duration')
  }

  clip.source_range.start_time.value += trimFrames
  clip.source_range.duration.value -= trimFrames
  return next
}

export function trimClipEnd(track: Track, clipId: string, trimFrames: number): Track {
  const next = cloneTrack(track)
  const clip = getClip(next, clipId)

  if (trimFrames <= 0) {
    return next
  }

  if (trimFrames >= clip.source_range.duration.value) {
    throw new Error('Trim end exceeds clip duration')
  }

  clip.source_range.duration.value -= trimFrames
  return next
}
