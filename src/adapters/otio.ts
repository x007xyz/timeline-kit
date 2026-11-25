import type {
  Clip as OtioClip,
  ExternalReference,
  GeneratorReference,
  MediaReference,
  RationalTime,
  TimeRange,
  Timeline as OtioTimeline,
  Track as OtioTrack,
} from '../otio-core'
import { createRationalTime } from '../otio-core'
import type { TimelineClip, TimelineDocument, TimelineTrack, TimelineTrimRange } from '../model/types'
import { DEMO_FPS, demoDocument } from '../model/demoDocument'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rationalTimeToMs(time: RationalTime | undefined): number {
  if (!time || !time.rate) {
    return 0
  }
  return (time.value / time.rate) * 1000
}

function msToRationalTime(ms: number, fps: number): RationalTime {
  const safeFps = fps > 0 ? fps : 24
  return createRationalTime(Math.round((ms / 1000) * safeFps), safeFps)
}

function rangeToMs(range: TimeRange): { startMs: number, durationMs: number } {
  return {
    startMs: rationalTimeToMs(range.start_time),
    durationMs: rationalTimeToMs(range.duration),
  }
}

function inferTrackKind(type: string): OtioTrack['kind'] {
  return type === 'audio' || type === 'music' ? 'Audio' : 'Video'
}

function extractClipResource(reference: MediaReference): string | undefined {
  if (reference.OTIO_SCHEMA === 'ExternalReference.1') {
    return reference.target_url
  }
  if (reference.OTIO_SCHEMA === 'GeneratorReference.1') {
    const content = reference.parameters.content ?? reference.parameters.text
    return typeof content === 'string' ? content : undefined
  }
  return undefined
}

function extractClipDurationMs(clip: OtioClip, legacyMeta?: Record<string, unknown>): number | undefined {
  if (clip.media_reference.OTIO_SCHEMA === 'ExternalReference.1' && clip.media_reference.available_range) {
    const ms = rationalTimeToMs(clip.media_reference.available_range.duration)
    if (ms > 0) {
      return ms
    }
  }

  const tkMeta = isRecord(clip.metadata?.timelineKit) ? clip.metadata.timelineKit : undefined
  if (typeof tkMeta?.durationMs === 'number' && tkMeta.durationMs > 0) {
    return tkMeta.durationMs
  }

  const legacySourceDurationSec = typeof legacyMeta?.sourceDurationSec === 'number'
    ? legacyMeta.sourceDurationSec * 1000
    : undefined
  if (legacySourceDurationSec && legacySourceDurationSec > 0) {
    return legacySourceDurationSec
  }

  const legacyResourceInfo = isRecord(legacyMeta?.resourceInfo) ? legacyMeta.resourceInfo : undefined
  if (typeof legacyResourceInfo?.duration === 'number' && legacyResourceInfo.duration > 0) {
    return legacyResourceInfo.duration
  }

  return undefined
}

function createMediaReference(clip: TimelineClip, fps: number): MediaReference {
  if (clip.type === 'text') {
    const parameters: Record<string, unknown> = {
      content: clip.resource ?? '',
    }
    if (clip.meta && typeof clip.meta === 'object') {
      Object.assign(parameters, clip.meta)
    }
    const generator: GeneratorReference = {
      OTIO_SCHEMA: 'GeneratorReference.1',
      generator_kind: 'timeline-kit:text',
      parameters,
    }
    return generator
  }

  const external: ExternalReference = {
    OTIO_SCHEMA: 'ExternalReference.1',
    target_url: clip.resource ?? '',
  }

  if (typeof clip.durationMs === 'number' && clip.durationMs > 0) {
    external.available_range = {
      start_time: createRationalTime(0, fps),
      duration: msToRationalTime(clip.durationMs, fps),
    }
  }

  return external
}

export function isOtioTimeline(value: unknown): value is OtioTimeline {
  return isRecord(value)
    && value.OTIO_SCHEMA === 'Timeline.1'
    && isRecord(value.tracks)
    && Array.isArray(value.tracks.children)
}

export function fromOtioTimeline(timeline: OtioTimeline): TimelineDocument {
  const fps = timeline.global_start_time?.rate && timeline.global_start_time.rate > 0
    ? timeline.global_start_time.rate
    : 24

  const tracks: TimelineTrack[] = timeline.tracks.children.map((otioTrack) => {
    const tkMeta = isRecord(otioTrack.metadata?.timelineKit) ? otioTrack.metadata.timelineKit : undefined
    const legacyMeta = isRecord(otioTrack.metadata?.flyCut) ? otioTrack.metadata.flyCut : undefined
    const trackType = typeof tkMeta?.type === 'string'
      ? tkMeta.type
      : typeof legacyMeta?.type === 'string'
        ? legacyMeta.type
        : otioTrack.kind === 'Audio'
          ? 'audio'
          : 'video'

    let cursorMs = 0
    const clips: TimelineClip[] = []

    for (const item of otioTrack.children) {
      const { startMs: sourceStartMs, durationMs } = rangeToMs(item.source_range)

      if (item.OTIO_SCHEMA === 'Gap.1') {
        cursorMs += durationMs
        continue
      }

      const clipTkMeta = isRecord(item.metadata?.timelineKit) ? item.metadata.timelineKit : undefined
      const clipLegacyMeta = isRecord(item.metadata?.flyCut) ? item.metadata.flyCut : undefined

      const clipType = typeof clipTkMeta?.type === 'string'
        ? clipTkMeta.type
        : typeof clipLegacyMeta?.assetType === 'string'
          ? clipLegacyMeta.assetType
          : typeof clipLegacyMeta?.type === 'string'
            ? clipLegacyMeta.type
            : trackType

      const clipStartMs = Math.round(cursorMs)
      const clipEndMs = Math.round(cursorMs + durationMs)
      cursorMs += durationMs

      let trim: TimelineTrimRange | undefined
      if (isRecord(clipTkMeta?.trim) && typeof clipTkMeta.trim.startMs === 'number' && typeof clipTkMeta.trim.endMs === 'number') {
        trim = { startMs: clipTkMeta.trim.startMs, endMs: clipTkMeta.trim.endMs }
      }
      else if (isRecord(clipLegacyMeta?.trimInfo) && typeof clipLegacyMeta.trimInfo.startMs === 'number' && typeof clipLegacyMeta.trimInfo.endMs === 'number') {
        trim = { startMs: clipLegacyMeta.trimInfo.startMs, endMs: clipLegacyMeta.trimInfo.endMs }
      }
      else if (sourceStartMs > 0 || (clipType === 'video' || clipType === 'audio')) {
        trim = {
          startMs: Math.round(sourceStartMs),
          endMs: Math.round(sourceStartMs + durationMs),
        }
      }

      const resource = typeof clipTkMeta?.resource === 'string'
        ? clipTkMeta.resource
        : typeof clipLegacyMeta?.resource === 'string'
          ? clipLegacyMeta.resource
          : extractClipResource(item.media_reference)

      const mediaDurationMs = extractClipDurationMs(item, clipLegacyMeta)

      const customMeta: Record<string, unknown> = {}
      if (item.metadata) {
        for (const [key, val] of Object.entries(item.metadata)) {
          if (key !== 'timelineKit' && key !== 'flyCut') {
            customMeta[key] = val
          }
        }
      }
      if (isRecord(clipTkMeta?.meta)) {
        Object.assign(customMeta, clipTkMeta.meta)
      }
      if (item.media_reference.OTIO_SCHEMA === 'GeneratorReference.1') {
        for (const [key, val] of Object.entries(item.media_reference.parameters)) {
          if (key !== 'content' && key !== 'text' && !(key in customMeta)) {
            customMeta[key] = val
          }
        }
      }

      clips.push({
        id: item.id,
        type: clipType,
        name: item.name,
        startMs: clipStartMs,
        endMs: clipEndMs,
        resource,
        durationMs: mediaDurationMs,
        trim,
        meta: Object.keys(customMeta).length > 0 ? customMeta : undefined,
      })
    }

    const trackCustomMeta: Record<string, unknown> = {}
    if (otioTrack.metadata) {
      for (const [key, val] of Object.entries(otioTrack.metadata)) {
        if (key !== 'timelineKit' && key !== 'flyCut') {
          trackCustomMeta[key] = val
        }
      }
    }
    if (isRecord(tkMeta?.meta)) {
      Object.assign(trackCustomMeta, tkMeta.meta)
    }

    const locked = typeof tkMeta?.locked === 'boolean'
      ? tkMeta.locked
      : typeof legacyMeta?.lock === 'boolean'
        ? legacyMeta.lock
        : undefined
    const visible = typeof tkMeta?.visible === 'boolean'
      ? tkMeta.visible
      : typeof legacyMeta?.visible === 'boolean'
        ? legacyMeta.visible
        : undefined
    const muted = typeof tkMeta?.muted === 'boolean'
      ? tkMeta.muted
      : typeof legacyMeta?.mute === 'boolean'
        ? legacyMeta.mute
        : undefined
    const main = typeof tkMeta?.main === 'boolean'
      ? tkMeta.main
      : typeof legacyMeta?.main === 'boolean'
        ? legacyMeta.main
        : undefined

    return {
      id: otioTrack.id,
      type: trackType,
      name: otioTrack.name,
      clips,
      locked,
      visible,
      muted,
      main,
      meta: Object.keys(trackCustomMeta).length > 0 ? trackCustomMeta : undefined,
    }
  })

  return {
    id: timeline.id || 'timeline-kit',
    name: timeline.name || 'Timeline',
    fps,
    tracks,
    meta: timeline.metadata ? { ...timeline.metadata } : undefined,
  }
}

export function toOtioTimeline(doc: TimelineDocument): OtioTimeline {
  const fps = doc.fps > 0 ? doc.fps : 24

  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: doc.id,
    name: doc.name,
    global_start_time: createRationalTime(0, fps),
    metadata: doc.meta ? { ...doc.meta } : {},
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: `${doc.name || 'Timeline'} Stack`,
      children: doc.tracks.map((track): OtioTrack => {
        const sortedClips = [...track.clips].sort((left, right) => left.startMs - right.startMs)
        const children: OtioTrack['children'] = []
        let cursorMs = 0

        for (const clip of sortedClips) {
          const gapMs = Math.max(0, clip.startMs - cursorMs)
          if (gapMs > 0) {
            children.push({
              OTIO_SCHEMA: 'Gap.1',
              id: `${track.id}:${clip.id}:gap`,
              name: `${clip.name} gap`,
              source_range: {
                start_time: createRationalTime(0, fps),
                duration: msToRationalTime(gapMs, fps),
              },
              metadata: {},
            })
          }

          const durationMs = Math.max(0, clip.endMs - clip.startMs)
          const clipMetadata: Record<string, unknown> = {
            timelineKit: {
              type: clip.type,
              resource: clip.resource,
              durationMs: clip.durationMs,
              trim: clip.trim ? { ...clip.trim } : undefined,
              meta: clip.meta ? { ...clip.meta } : undefined,
            },
          }

          children.push({
            OTIO_SCHEMA: 'Clip.1',
            id: clip.id,
            name: clip.name,
            media_reference: createMediaReference(clip, fps),
            source_range: {
              start_time: msToRationalTime(clip.trim?.startMs ?? 0, fps),
              duration: msToRationalTime(durationMs, fps),
            },
            metadata: clipMetadata,
          })

          cursorMs = Math.max(cursorMs, clip.endMs)
        }

        return {
          OTIO_SCHEMA: 'Track.1',
          id: track.id,
          name: track.name,
          kind: inferTrackKind(track.type),
          metadata: {
            timelineKit: {
              type: track.type,
              locked: track.locked,
              visible: track.visible,
              muted: track.muted,
              main: track.main,
              meta: track.meta ? { ...track.meta } : undefined,
            },
          },
          children,
        }
      }),
    },
  }
}

export const OTIO_DEMO_FPS = DEMO_FPS
export const otioDemoTimeline: OtioTimeline = toOtioTimeline(demoDocument)
