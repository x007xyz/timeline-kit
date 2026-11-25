import type { TimelineHitTarget } from '../engine/hitTest'
import type { TimelineLayoutSnapshot } from '../engine/layout'
import type { SnapProvider } from '../engine/snap'
import type { EditPolicies } from '../model/types'
import type { CommandBus } from '../store/commandBus'
import type { TimelineStore } from '../store/store'
import type { CommandSpec } from '../store/types'

export interface DragPreviewBox {
  leftPx: number
  topPx: number
  widthPx: number
  heightPx: number
  label?: string
}

export interface MarqueeRect {
  leftPx: number
  topPx: number
  widthPx: number
  heightPx: number
}

export interface OverlayState {
  verticalGuidelinePx: number | null
  horizontalGuidelinePx: number | null
  dragPreview: DragPreviewBox | null
  marqueeRect: MarqueeRect | null
}

export interface ClipPreviewOverride {
  leftPx?: number
  widthPx?: number
  translateX?: number
  translateY?: number
  isDragging?: boolean
  isTrimming?: boolean
}

export interface ViewportMetrics {
  scrollLeft: number
  scrollTop: number
  clientWidth: number
  clientHeight: number
  trackPaddingLeft: number
}

export interface PluginRendererPort {
  getLayout: () => TimelineLayoutSnapshot
  getViewportMetrics: () => ViewportMetrics
  setScrollLeft: (scrollLeft: number) => void
  setOverlay: (patch: Partial<OverlayState>) => void
  clearOverlay: () => void
  setClipPreview: (clipId: string, override: ClipPreviewOverride | null) => void
  clearAllClipPreviews: () => void
  lockUserSelect?: () => void
  restoreUserSelect?: () => void
  focusContainer?: () => void
}

export interface TimelinePointerEvent {
  originalEvent: PointerEvent
  hit: TimelineHitTarget
  clientX: number
  clientY: number
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  button: number
}

export interface TimelineWheelEvent {
  originalEvent: WheelEvent
  hit: TimelineHitTarget
  deltaX: number
  deltaY: number
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

export interface TimelineDropEvent {
  originalEvent: DragEvent
  hit: TimelineHitTarget
  dataTransfer: DataTransfer | null
}

export interface InteractionSession {
  onMove?: (event: TimelinePointerEvent) => void
  onEnd?: (event: TimelinePointerEvent) => void
  onCancel?: () => void
}

export interface InteractionHandler {
  id: string
  priority: number
  onPointerDown?: (event: TimelinePointerEvent, ctx: PluginContext) => InteractionSession | null | void
  onWheel?: (event: TimelineWheelEvent, ctx: PluginContext) => boolean | void
  onDragOver?: (event: TimelineDropEvent, ctx: PluginContext) => boolean | void
  onDragLeave?: (ctx: PluginContext) => void
  onDrop?: (event: TimelineDropEvent, ctx: PluginContext) => boolean | void
  onKeyDown?: (event: KeyboardEvent, ctx: PluginContext) => boolean | void
  onKeyUp?: (event: KeyboardEvent, ctx: PluginContext) => boolean | void
}

export type KeyBinding = string | ((event: KeyboardEvent, ctx: PluginContext) => boolean | void)

export interface PluginContext {
  store: TimelineStore
  commands: CommandBus
  renderer: PluginRendererPort
  getPolicies: () => EditPolicies
  getSnapProviders: () => readonly SnapProvider[]
}

export interface TimelinePlugin {
  name: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous payload types per command
  commands?: Record<string, CommandSpec<any>>
  keymap?: Record<string, KeyBinding | null>
  interactions?: InteractionHandler[]
  snapProviders?: SnapProvider[]
  setup?: (ctx: PluginContext) => (() => void) | void
}
