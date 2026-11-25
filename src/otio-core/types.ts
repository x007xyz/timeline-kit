export interface RationalTime {
  value: number
  rate: number
}

export interface TimeRange {
  start_time: RationalTime
  duration: RationalTime
}

export interface BaseMediaReference {
  name?: string
  metadata?: Record<string, unknown>
}

export interface ExternalReference extends BaseMediaReference {
  OTIO_SCHEMA: 'ExternalReference.1'
  target_url: string
  available_range?: TimeRange
}

export interface GeneratorReference extends BaseMediaReference {
  OTIO_SCHEMA: 'GeneratorReference.1'
  generator_kind: string
  parameters: Record<string, unknown>
}

export interface MissingReference extends BaseMediaReference {
  OTIO_SCHEMA: 'MissingReference.1'
}

export type MediaReference = ExternalReference | GeneratorReference | MissingReference

export interface BaseItem {
  id: string
  name: string
  source_range: TimeRange
  metadata?: Record<string, unknown>
}

export interface Clip extends BaseItem {
  OTIO_SCHEMA: 'Clip.1'
  media_reference: MediaReference
}

export interface Gap extends BaseItem {
  OTIO_SCHEMA: 'Gap.1'
}

export type TimelineItem = Clip | Gap

export interface Track {
  OTIO_SCHEMA: 'Track.1'
  id: string
  name: string
  kind: 'Video' | 'Audio'
  metadata?: Record<string, unknown>
  children: TimelineItem[]
}

export interface Stack {
  OTIO_SCHEMA: 'Stack.1'
  name?: string
  children: Track[]
}

export interface Timeline {
  OTIO_SCHEMA: 'Timeline.1'
  id: string
  name: string
  global_start_time?: RationalTime
  tracks: Stack
  metadata?: Record<string, unknown>
}
