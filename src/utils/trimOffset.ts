import type { Clip as OtioClip } from '../otio-core'

function isOtioClip(clip: unknown): clip is OtioClip {
  return typeof clip === 'object' && clip !== null && (clip as { OTIO_SCHEMA?: unknown }).OTIO_SCHEMA === 'Clip.1'
}

function toMilliseconds(time?: { value: number, rate: number }): number {
  if (!time || !time.rate) {
    return 0
  }
  return (time.value / time.rate) * 1000
}

/**
 * Compute normalized trim start offset percentage and visible window scale percentage.
 * Supports TimelineClip (`trim` + `durationMs`), legacy clips (`trimInfo` + `resourceInfo`),
 * and OTIO `Clip.1` items.
 */
export function getTrimOffset(clip: any): { offsetPercent: number, scalePercent: number } {
  if (!clip || typeof clip !== 'object') {
    return { offsetPercent: 0, scalePercent: 100 }
  }

  if (isOtioClip(clip)) {
    const trimStartMs = toMilliseconds(clip.source_range?.start_time)
    const trimDurationMs = toMilliseconds(clip.source_range?.duration)
    const availableDurationMs = clip.media_reference?.OTIO_SCHEMA === 'ExternalReference.1' && clip.media_reference.available_range
      ? toMilliseconds(clip.media_reference.available_range.duration)
      : undefined
    const tkDurationMs = Number((clip.metadata as Record<string, any> | undefined)?.timelineKit?.durationMs ?? 0) || undefined
    const totalDuration = availableDurationMs ?? tkDurationMs ?? trimDurationMs

    if (!totalDuration || totalDuration <= 0) {
      return { offsetPercent: 0, scalePercent: 100 }
    }

    return {
      offsetPercent: (trimStartMs / totalDuration) * 100,
      scalePercent: (trimDurationMs / totalDuration) * 100,
    }
  }

  if (clip.trim && typeof clip.trim.startMs === 'number' && typeof clip.trim.endMs === 'number') {
    const totalDuration = typeof clip.durationMs === 'number' && clip.durationMs > 0
      ? clip.durationMs
      : Math.max(0, (clip.endMs ?? 0) - (clip.startMs ?? 0))
    if (totalDuration <= 0) {
      return { offsetPercent: 0, scalePercent: 100 }
    }
    return {
      offsetPercent: (clip.trim.startMs / totalDuration) * 100,
      scalePercent: ((clip.trim.endMs - clip.trim.startMs) / totalDuration) * 100,
    }
  }

  if (!clip.trimInfo || !clip.resourceInfo) {
    return { offsetPercent: 0, scalePercent: 100 }
  }

  const { startMs, endMs } = clip.trimInfo
  const totalDuration = clip.resourceInfo.duration || (clip.end - clip.start)
  if (!totalDuration || totalDuration <= 0) {
    return { offsetPercent: 0, scalePercent: 100 }
  }

  return {
    offsetPercent: (startMs / totalDuration) * 100,
    scalePercent: ((endMs - startMs) / totalDuration) * 100,
  }
}
