import type { RationalTime, Timeline, TimelineItem, Track } from '../types'

export function toSeconds(time: RationalTime): number {
  return time.rate === 0 ? 0 : time.value / time.rate
}

export function getItemDurationSeconds(item: TimelineItem): number {
  return toSeconds(item.source_range.duration)
}

export function getTrackDurationSeconds(track: Track): number {
  return track.children.reduce((total, item) => total + getItemDurationSeconds(item), 0)
}

export function getTimelineDurationSeconds(timeline: Timeline): number {
  return timeline.tracks.children.reduce((max, track) => Math.max(max, getTrackDurationSeconds(track)), 0)
}
