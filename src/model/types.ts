export interface TimelineTrimRange {
  startMs: number
  endMs: number
}

export interface TimelineClip<TMeta = Record<string, unknown>> {
  id: string
  type: string
  name: string
  startMs: number
  endMs: number
  resource?: string
  durationMs?: number
  trim?: TimelineTrimRange
  meta?: TMeta
}

export interface TimelineTrack<
  TTrackMeta = Record<string, unknown>,
  TClipMeta = Record<string, unknown>,
> {
  id: string
  type: string
  name: string
  clips: TimelineClip<TClipMeta>[]
  locked?: boolean
  visible?: boolean
  muted?: boolean
  main?: boolean
  meta?: TTrackMeta
}

export interface TimelineDocument<
  TTrackMeta = Record<string, unknown>,
  TClipMeta = Record<string, unknown>,
> {
  id: string
  name: string
  fps: number
  tracks: TimelineTrack<TTrackMeta, TClipMeta>[]
  meta?: Record<string, unknown>
}

export interface TimelineSelection {
  trackIndex: number
  clipIndex: number
  clipId: string | null
  clipIds: string[]
}

export interface EditDropContext {
  clip: TimelineClip
  sourceTrack?: TimelineTrack
  targetTrack: TimelineTrack
  startMs: number
  endMs: number
}

export interface EditPolicies {
  allowOverlap: boolean
  allowCrossTrackType: boolean
  removeEmptyTracks: boolean
  orderAudioToBottom: boolean
  minClipDurationMs?: number
  canDrop?: (ctx: EditDropContext) => boolean
}

export const DEFAULT_EDIT_POLICIES: EditPolicies = {
  allowOverlap: false,
  allowCrossTrackType: false,
  removeEmptyTracks: true,
  orderAudioToBottom: true,
}
