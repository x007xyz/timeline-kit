import type { Clip, Gap, MediaReference, RationalTime, Timeline, Track } from '../types'
import { createId } from './helpers'

export function createRationalTime(value: number, rate: number): RationalTime {
  return { value, rate }
}

export function createTimeline(name: string, fps: number = 30): Timeline {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: createId(),
    name,
    global_start_time: createRationalTime(0, fps),
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'Root Stack',
      children: [],
    },
    metadata: {},
  }
}

export function createTrack(name: string, kind: Track['kind']): Track {
  return {
    OTIO_SCHEMA: 'Track.1',
    id: createId(),
    name,
    kind,
    metadata: {},
    children: [],
  }
}

export function createClip(name: string, reference: MediaReference, durationFrames: number, fps: number): Clip {
  return {
    OTIO_SCHEMA: 'Clip.1',
    id: createId(),
    name,
    media_reference: reference,
    source_range: {
      start_time: createRationalTime(0, fps),
      duration: createRationalTime(durationFrames, fps),
    },
    metadata: {},
  }
}

export function createGap(name: string, durationFrames: number, fps: number): Gap {
  return {
    OTIO_SCHEMA: 'Gap.1',
    id: createId(),
    name,
    source_range: {
      start_time: createRationalTime(0, fps),
      duration: createRationalTime(durationFrames, fps),
    },
    metadata: {},
  }
}
