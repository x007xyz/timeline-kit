import type { Clip, Track } from '../types'
import { isClip } from '../guards'
import { cloneTrack, createId } from './helpers'

export function splitClip(track: Track, clipId: string, splitFrames: number): Track {
  const next = cloneTrack(track)
  const index = next.children.findIndex(item => item.id === clipId)
  const item = next.children[index]

  if (index === -1 || !item || !isClip(item)) {
    throw new Error(`Clip ${clipId} not found`)
  }

  if (splitFrames <= 0 || splitFrames >= item.source_range.duration.value) {
    throw new Error('Split point must be inside clip duration')
  }

  const first: Clip = {
    ...item,
    id: createId('clip'),
    source_range: {
      start_time: { ...item.source_range.start_time },
      duration: {
        ...item.source_range.duration,
        value: splitFrames,
      },
    },
  }

  const second: Clip = {
    ...item,
    id: createId('clip'),
    source_range: {
      start_time: {
        ...item.source_range.start_time,
        value: item.source_range.start_time.value + splitFrames,
      },
      duration: {
        ...item.source_range.duration,
        value: item.source_range.duration.value - splitFrames,
      },
    },
  }

  next.children.splice(index, 1, first, second)
  return next
}
