import type { Clip, Gap, TimelineItem, Track } from './types'

export function isClip(item: TimelineItem): item is Clip {
  return item.OTIO_SCHEMA === 'Clip.1'
}

export function isGap(item: TimelineItem): item is Gap {
  return item.OTIO_SCHEMA === 'Gap.1'
}

export function isAudioTrack(track: Track): boolean {
  return track.kind === 'Audio'
}

export function isVideoTrack(track: Track): boolean {
  return track.kind === 'Video'
}
