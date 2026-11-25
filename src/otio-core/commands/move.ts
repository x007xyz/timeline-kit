import type { Clip, Track } from '../types'
import { isClip } from '../guards'
import { cloneTrack, mergeAdjacentGaps } from './helpers'
import { createGap } from './create'
import { insertClipWithGap } from './insert'

export function moveClip(track: Track, clipId: string, targetStartSeconds: number, fps: number): Track {
  const next = cloneTrack(track)
  const index = next.children.findIndex(item => item.id === clipId)
  const item = next.children[index]

  if (index === -1 || !item || !isClip(item)) {
    throw new Error(`Clip ${clipId} not found`)
  }

  const movedClip: Clip = item
  const sourceGap = createGap(`${item.name} gap`, item.source_range.duration.value, fps)
  next.children.splice(index, 1, sourceGap)

  const withMergedGaps = {
    ...next,
    children: mergeAdjacentGaps(next.children),
  }

  return insertClipWithGap(withMergedGaps, movedClip, targetStartSeconds, fps)
}
