import type { TimelineItem, Track } from '../types'
import { isGap } from '../guards'
import { getItemDurationSeconds } from './timeline'

export interface TrackItemOffset {
  item: TimelineItem
  start: number
  end: number
}

export function getTrackItemOffsets(track: Track): TrackItemOffset[] {
  let cursor = 0

  return track.children.map((item) => {
    const duration = getItemDurationSeconds(item)
    const offset = {
      item,
      start: cursor,
      end: cursor + duration,
    }
    cursor += duration
    return offset
  })
}

export function getTrackVisibleItemsAtTime(track: Track, timeSec: number): TrackItemOffset[] {
  return getTrackItemOffsets(track).filter(({ item, start, end }) => !isGap(item) && timeSec >= start && timeSec < end)
}
