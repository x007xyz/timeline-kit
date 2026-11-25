import type { TimelineClip, TimelineTrack } from '../model/types'
import type { TimelineRenderHints, TimelineState } from '../store/types'

export interface SlotHandle<TCtx> {
  update?: (ctx: TCtx) => void
  destroy?: () => void
}

export interface SlotRendererObject<TCtx> {
  mount: (host: HTMLElement, ctx: TCtx) => SlotHandle<TCtx> | void
}

export type SlotRendererFn<TCtx> = (ctx: TCtx) => HTMLElement | string | null | undefined

export type SlotRenderer<TCtx> = SlotRendererObject<TCtx> | SlotRendererFn<TCtx>

export function isSlotRendererObject<TCtx>(
  slot: SlotRenderer<TCtx>,
): slot is SlotRendererObject<TCtx> {
  return typeof slot === 'object' && slot !== null && typeof slot.mount === 'function'
}

function applyFnResult(host: HTMLElement, content: HTMLElement | string | null | undefined): void {
  if (content == null) {
    host.replaceChildren()
    return
  }
  if (typeof content === 'string') {
    host.textContent = content
    return
  }
  host.replaceChildren(content)
}

export function normalizeSlotRenderer<TCtx>(slot: SlotRenderer<TCtx>): SlotRendererObject<TCtx> {
  if (isSlotRendererObject(slot)) {
    return slot
  }

  return {
    mount(host, ctx) {
      applyFnResult(host, slot(ctx))
      return {
        update(nextCtx) {
          applyFnResult(host, slot(nextCtx))
        },
        destroy() {
          host.replaceChildren()
        },
      }
    },
  }
}

export interface ClipRenderContext {
  clip: TimelineClip
  track: TimelineTrack
  trackIndex: number
  clipIndex: number
  isSelected: boolean
  renderHints: TimelineRenderHints
  clipWidthPx: number
  isVisible: boolean
}

export interface TrackHeaderContext {
  track: TimelineTrack
  trackIndex: number
  height: number
}

export interface TrackConfig {
  type: string
  name?: string
  height?: number
  icon?: SlotRenderer<TrackHeaderContext>
  clip?: SlotRenderer<ClipRenderContext>
}

export type TrackConfigMap = Record<string, TrackConfig>

export interface ToolbarContext {
  snapshot: TimelineState
}

export interface ToolbarConfig {
  id: string
  sort: number
  position: 'left' | 'right'
  label?: string
  title?: string
  command?: string
  isDisabled?: (ctx: ToolbarContext) => boolean
  isActive?: (ctx: ToolbarContext) => boolean
  render?: (ctx: ToolbarContext) => HTMLElement | string | null
}

export interface SidebarConfig {
  width?: number
  showTrackActions?: boolean
}

export interface UIConfig {
  toolbar?: boolean | ToolbarConfig[]
  sidebar?: boolean | SidebarConfig
  ruler?: boolean
}

export interface MediaProvider {
  renderFilmstrip?: (canvas: HTMLCanvasElement, ctx: ClipRenderContext) => (() => void) | void
  renderWaveform?: (canvas: HTMLCanvasElement, ctx: ClipRenderContext) => (() => void) | void
}
