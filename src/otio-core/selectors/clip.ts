import type { Clip } from '../types'
import { toSeconds } from './timeline'

export function getClipSourceStartSeconds(clip: Clip): number {
  return toSeconds(clip.source_range.start_time)
}

export function getClipSourceDurationSeconds(clip: Clip): number {
  return toSeconds(clip.source_range.duration)
}

export function getClipSourceEndSeconds(clip: Clip): number {
  return getClipSourceStartSeconds(clip) + getClipSourceDurationSeconds(clip)
}
