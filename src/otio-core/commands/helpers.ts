import type { Gap, TimelineItem, Track } from '../types'
import { isGap } from '../guards'

export function createId(prefix: string = 'otio'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function cloneTrack(track: Track): Track {
  return {
    ...track,
    children: track.children.map(item => ({
      ...item,
      source_range: {
        start_time: { ...item.source_range.start_time },
        duration: { ...item.source_range.duration },
      },
      metadata: item.metadata ? { ...item.metadata } : undefined,
      ...(item.OTIO_SCHEMA === 'Clip.1'
        ? {
            media_reference: {
              ...item.media_reference,
              metadata: item.media_reference.metadata ? { ...item.media_reference.metadata } : undefined,
            },
          }
        : {}),
    })),
  }
}

export function mergeAdjacentGaps(items: TimelineItem[]): TimelineItem[] {
  const next: TimelineItem[] = []

  for (const item of items) {
    if (isGap(item) && item.source_range.duration.value <= 0) {
      continue
    }

    const previous = next.at(-1)
    if (previous && isGap(previous) && isGap(item)) {
      previous.source_range.duration.value += item.source_range.duration.value
      continue
    }

    next.push(item)
  }

  return next
}

export function createGapLike(source: Gap, durationFrames: number): Gap {
  return {
    ...source,
    id: createId('gap'),
    source_range: {
      start_time: { ...source.source_range.start_time },
      duration: {
        ...source.source_range.duration,
        value: durationFrames,
      },
    },
  }
}
