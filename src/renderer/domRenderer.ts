import type { HitZone, TimelineHitTarget } from '../engine/hitTest'
import { hitTestLayout } from '../engine/hitTest'
import { computeTimelineLayout, type LayoutClip, type LayoutTrack, type TimelineLayoutSnapshot } from '../engine/layout'
import { frameToSeconds } from '../engine/timeScale'
import { computeVisibleRange, filterVisibleClips } from '../engine/virtualization'
import type { TimelineClip, TimelineDocument } from '../model/types'
import type {
  ClipPreviewOverride,
  OverlayState,
  PluginRendererPort,
  ViewportMetrics,
} from '../plugins/types'
import type { RenderChannel, ThemeMode, TimelineState } from '../store/types'
import { getTrimOffset } from '../utils/trimOffset'
import { drawTimeRuler } from './ruler'
import { ensureTimelineStyles } from './styles'
import {
  normalizeSlotRenderer,
  type ClipRenderContext,
  type MediaProvider,
  type SlotHandle,
  type SlotRenderer,
  type TrackConfigMap,
  type UIConfig,
} from './types'
import { SidebarRenderer } from './ui/sidebar'
import { ToolbarRenderer } from './ui/toolbar'

const TRACK_PADDING_LEFT = 10
const TRACK_PADDING_RIGHT = 200
const RULER_HEIGHT = 20
const MIN_CLIP_WIDTH_PX = 32
const SCROLL_REV_THRESHOLD_PX = 100

interface RenderRefs {
  root: HTMLDivElement
  toolbar: HTMLDivElement
  workspace: HTMLDivElement
  sidebar: HTMLDivElement
  sidebarHeader: HTMLDivElement
  sidebarBody: HTMLDivElement
  main: HTMLDivElement
  mainScroller: HTMLDivElement
  ruler: HTMLDivElement
  rulerCanvas: HTMLCanvasElement
  tracksViewport: HTMLDivElement
  tracks: HTMLDivElement
  emptyState: HTMLDivElement
  preview: HTMLDivElement
  marquee: HTMLDivElement
  playhead: HTMLDivElement
  verticalGuideline: HTMLDivElement
  horizontalGuideline: HTMLDivElement
}

interface MountedClipRecord {
  clipId: string
  clipNode: HTMLDivElement
  contentHost: HTMLDivElement
  selectionFrame: HTMLDivElement
  leftHandle: HTMLDivElement
  rightHandle: HTMLDivElement
  slotRef?: SlotRenderer<ClipRenderContext>
  slotHandle?: SlotHandle<ClipRenderContext>
  mediaCleanups: Array<() => void>
  lastRenderKey?: string
}

export interface DomRendererOptions {
  trackConfigs?: TrackConfigMap
  ui?: UIConfig
  theme?: ThemeMode
  injectStyles?: boolean
  mediaProvider?: MediaProvider
}

function createFilmstripPlaceholders(): HTMLSpanElement[] {
  return Array.from({ length: 6 }, () => {
    const placeholder = document.createElement('span')
    placeholder.className = 'tk-media-clip-filmstrip-placeholder'
    return placeholder
  })
}

export class DomTimelineRenderer implements PluginRendererPort {
  private readonly container: HTMLElement
  private readonly refs: RenderRefs
  private readonly toolbarRenderer: ToolbarRenderer
  private readonly sidebarRenderer: SidebarRenderer
  private readonly mountedClips: Map<string, MountedClipRecord>
  private readonly clipPreviewOverrides: Map<string, ClipPreviewOverride>
  private readonly overlayState: OverlayState
  private trackConfigs: TrackConfigMap
  private uiConfig: UIConfig
  private mediaProvider: MediaProvider | undefined
  private layout: TimelineLayoutSnapshot
  private lastState: TimelineState | null
  private lastVirtualizedScrollLeft: number
  private previousUserSelect: string

  constructor(container: HTMLElement, options: DomRendererOptions = {}) {
    this.container = container
    this.trackConfigs = options.trackConfigs ?? {}
    this.uiConfig = options.ui ?? {}
    this.mediaProvider = options.mediaProvider
    this.mountedClips = new Map()
    this.clipPreviewOverrides = new Map()
    this.lastState = null
    this.lastVirtualizedScrollLeft = 0
    this.previousUserSelect = ''
    this.overlayState = {
      verticalGuidelinePx: null,
      horizontalGuidelinePx: null,
      dragPreview: null,
      marqueeRect: null,
    }

    ensureTimelineStyles(options.injectStyles !== false)
    this.refs = this.mountDom(options.theme ?? 'auto')
    this.toolbarRenderer = new ToolbarRenderer(this.refs.toolbar)
    this.sidebarRenderer = new SidebarRenderer(
      this.refs.sidebar,
      this.refs.sidebarHeader,
      this.refs.sidebarBody,
    )

    this.layout = computeTimelineLayout(
      { id: 'init', name: 'init', fps: 24, tracks: [] },
      { trackScale: 50, trackConfigs: this.trackConfigs },
    )
  }

  getRootElement(): HTMLElement {
    return this.refs.root
  }

  getMainScrollerElement(): HTMLElement {
    return this.refs.mainScroller
  }

  setTrackConfigs(trackConfigs: TrackConfigMap): void {
    this.trackConfigs = trackConfigs
  }

  setUIConfig(uiConfig: UIConfig): void {
    this.uiConfig = uiConfig
  }

  setMediaProvider(provider: MediaProvider | undefined): void {
    this.mediaProvider = provider
    for (const record of this.mountedClips.values()) {
      record.lastRenderKey = undefined
    }
  }

  getLayout(): TimelineLayoutSnapshot {
    return this.layout
  }

  getViewportMetrics(): ViewportMetrics {
    return {
      scrollLeft: this.refs.mainScroller.scrollLeft,
      scrollTop: this.refs.mainScroller.scrollTop,
      clientWidth: this.refs.mainScroller.clientWidth || 640,
      clientHeight: this.refs.mainScroller.clientHeight || 300,
      trackPaddingLeft: TRACK_PADDING_LEFT,
    }
  }

  setScrollLeft(scrollLeft: number): void {
    this.refs.mainScroller.scrollLeft = Math.max(0, scrollLeft)
    this.handleScroll()
  }

  lockUserSelect(): void {
    if (this.previousUserSelect) {
      return
    }
    this.previousUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
  }

  restoreUserSelect(): void {
    document.body.style.userSelect = this.previousUserSelect
    this.previousUserSelect = ''
  }

  focusContainer(): void {
    this.refs.root.focus({ preventScroll: true })
  }

  setOverlay(patch: Partial<OverlayState>): void {
    Object.assign(this.overlayState, patch)
    this.renderOverlay()
  }

  clearOverlay(): void {
    this.overlayState.verticalGuidelinePx = null
    this.overlayState.horizontalGuidelinePx = null
    this.overlayState.dragPreview = null
    this.overlayState.marqueeRect = null
    this.renderOverlay()
  }

  setClipPreview(clipId: string, override: ClipPreviewOverride | null): void {
    if (override === null) {
      this.clipPreviewOverrides.delete(clipId)
    }
    else {
      this.clipPreviewOverrides.set(clipId, override)
    }
    this.applyClipPreview(clipId)
  }

  clearAllClipPreviews(): void {
    const ids = Array.from(this.clipPreviewOverrides.keys())
    this.clipPreviewOverrides.clear()
    for (const clipId of ids) {
      this.applyClipPreview(clipId)
    }
  }

  render(state: TimelineState, dirty?: ReadonlySet<RenderChannel>): void {
    this.lastState = state
    this.refs.root.dataset.theme = state.theme

    const fullRender = !dirty
    const shouldRecomputeLayout = fullRender
      || dirty.has('tracks')
      || dirty.has('ruler')
      || dirty.has('sidebar')

    if (shouldRecomputeLayout) {
      this.layout = computeTimelineLayout(state.document, {
        trackScale: state.trackScale,
        trackConfigs: this.trackConfigs,
        viewportHeight: this.refs.tracksViewport.clientHeight,
      })
    }

    const showRuler = this.uiConfig.ruler !== false
    this.refs.ruler.style.display = showRuler ? '' : 'none'
    this.refs.tracksViewport.style.minHeight = showRuler ? 'calc(100% - 20px)' : '100%'

    if (fullRender || dirty.has('toolbar')) {
      this.toolbarRenderer.render(state, this.uiConfig.toolbar)
    }

    if (fullRender || dirty.has('sidebar') || dirty.has('tracks')) {
      this.sidebarRenderer.render(this.layout, this.trackConfigs, this.uiConfig.sidebar, showRuler)
    }

    if (showRuler && (fullRender || dirty.has('ruler') || dirty.has('tracks'))) {
      this.renderRuler(state)
    }

    if (fullRender || dirty.has('tracks')) {
      this.renderTracks(state)
      this.lastVirtualizedScrollLeft = this.refs.mainScroller.scrollLeft
    }
    else if (dirty.has('selection')) {
      this.renderSelectionOnly(state)
    }

    if (fullRender || dirty.has('playhead') || dirty.has('tracks') || dirty.has('ruler')) {
      this.positionPlayhead(state)
    }

    if (fullRender || dirty.has('overlay')) {
      this.renderOverlay()
    }

    if (fullRender || dirty.has('sidebar') || dirty.has('tracks')) {
      const rowEls = Array.from(this.refs.tracks.children) as HTMLElement[]
      this.sidebarRenderer.syncHeights(rowEls)
      this.sidebarRenderer.syncScroll(this.refs.mainScroller.scrollTop)
    }
  }

  handleScroll(): void {
    const scrollTop = this.refs.mainScroller.scrollTop
    const scrollLeft = this.refs.mainScroller.scrollLeft
    this.sidebarRenderer.syncScroll(scrollTop)

    if (!this.lastState) {
      return
    }

    this.positionPlayhead(this.lastState)
    if (this.uiConfig.ruler !== false) {
      this.renderRuler(this.lastState)
    }

    if (Math.abs(scrollLeft - this.lastVirtualizedScrollLeft) >= SCROLL_REV_THRESHOLD_PX) {
      this.renderTracks(this.lastState)
      this.lastVirtualizedScrollLeft = scrollLeft
    }
  }

  hitTestClientPoint(
    clientX: number,
    clientY: number,
    target: EventTarget | null,
    doc: TimelineDocument,
  ): TimelineHitTarget {
    const el = target instanceof Element ? target : null
    const scrollerRect = this.refs.mainScroller.getBoundingClientRect()
    const viewportRect = this.refs.tracksViewport.getBoundingClientRect()
    const hitX = Math.max(
      0,
      clientX - scrollerRect.left + this.refs.mainScroller.scrollLeft - TRACK_PADDING_LEFT,
    )
    const y = clientY - viewportRect.top

    let zoneHint: HitZone | undefined
    let hintClipId: string | null = null
    let hintTrackIndex: number | undefined

    if (el) {
      if (el.closest('.tk-timeline-toolbar')) {
        zoneHint = 'toolbar'
      }
      else if (el.closest('.tk-timeline-sidebar')) {
        zoneHint = 'sidebar'
      }
      else if (el.closest('.tk-playhead-handle')) {
        zoneHint = 'playhead'
      }
      else if (el.closest('.tk-timeline-ruler')) {
        zoneHint = 'ruler'
      }
      else {
        const trimEdge = el.closest('[data-trim-edge]') as HTMLElement | null
        const clipEl = el.closest('.tk-track-clip') as HTMLElement | null
        if (clipEl) {
          hintClipId = clipEl.dataset.clipId ?? null
          if (trimEdge?.dataset.trimEdge === 'start') {
            zoneHint = 'trim-start'
          }
          else if (trimEdge?.dataset.trimEdge === 'end') {
            zoneHint = 'trim-end'
          }
          else {
            zoneHint = 'clip-body'
          }
        }
        else if (!el.closest('.tk-timeline-editor')) {
          zoneHint = 'outside'
        }
      }
    }

    return hitTestLayout(this.layout, doc, {
      x: hitX,
      y,
      zoneHint,
      hintClipId,
      hintTrackIndex,
    })
  }

  destroy(): void {
    this.restoreUserSelect()
    for (const record of this.mountedClips.values()) {
      record.slotHandle?.destroy?.()
      record.mediaCleanups.forEach(fn => fn())
    }
    this.mountedClips.clear()
    this.clipPreviewOverrides.clear()
    this.toolbarRenderer.destroy()
    this.sidebarRenderer.destroy()
    this.container.replaceChildren()
  }

  private mountDom(theme: ThemeMode): RenderRefs {
    const root = document.createElement('div')
    root.className = 'tk-timeline-editor'
    root.tabIndex = 0
    root.dataset.theme = theme

    const toolbar = document.createElement('div')
    toolbar.className = 'tk-timeline-toolbar'

    const workspace = document.createElement('div')
    workspace.className = 'tk-timeline-workspace'

    const sidebar = document.createElement('div')
    sidebar.className = 'tk-timeline-sidebar'
    const sidebarHeader = document.createElement('div')
    sidebarHeader.className = 'tk-timeline-sidebar-header'
    const sidebarBody = document.createElement('div')
    sidebarBody.className = 'tk-timeline-sidebar-body'
    sidebar.append(sidebarHeader, sidebarBody)

    const main = document.createElement('div')
    main.className = 'tk-timeline-main'
    const mainScroller = document.createElement('div')
    mainScroller.className = 'tk-timeline-main-scroller'

    const ruler = document.createElement('div')
    ruler.className = 'tk-timeline-ruler'
    const rulerCanvas = document.createElement('canvas')
    rulerCanvas.className = 'tk-ruler-canvas'
    ruler.appendChild(rulerCanvas)

    const tracksViewport = document.createElement('div')
    tracksViewport.className = 'tk-tracks-viewport'
    const tracks = document.createElement('div')
    tracks.className = 'tk-tracks'
    const emptyState = document.createElement('div')
    emptyState.className = 'tk-empty-state'
    emptyState.textContent = '暂无轨道数据'

    const preview = document.createElement('div')
    preview.className = 'tk-drag-preview'
    preview.textContent = '移动到此处'

    const marquee = document.createElement('div')
    marquee.className = 'tk-marquee'

    const verticalGuideline = document.createElement('div')
    verticalGuideline.className = 'tk-guideline tk-guideline-vertical'
    const horizontalGuideline = document.createElement('div')
    horizontalGuideline.className = 'tk-guideline tk-guideline-horizontal'

    tracksViewport.append(tracks, emptyState, preview, marquee, verticalGuideline, horizontalGuideline)
    mainScroller.append(ruler, tracksViewport)

    const playhead = document.createElement('div')
    playhead.className = 'tk-playhead'
    const handle = document.createElement('div')
    handle.className = 'tk-playhead-handle'
    playhead.appendChild(handle)

    main.append(mainScroller, playhead)
    workspace.append(sidebar, main)
    root.append(toolbar, workspace)

    this.container.replaceChildren(root)

    return {
      root,
      toolbar,
      workspace,
      sidebar,
      sidebarHeader,
      sidebarBody,
      main,
      mainScroller,
      ruler,
      rulerCanvas,
      tracksViewport,
      tracks,
      emptyState,
      preview,
      marquee,
      playhead,
      verticalGuideline,
      horizontalGuideline,
    }
  }

  private resolveIsDark(theme: ThemeMode): boolean {
    if (theme === 'dark') {
      return true
    }
    if (theme === 'light') {
      return false
    }
    if (this.container.closest('.dark') !== null) {
      return true
    }
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return false
  }

  private renderRuler(state: TimelineState): void {
    const dark = this.resolveIsDark(state.theme)
    const ratio = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1
    const canvas = this.refs.rulerCanvas
    const cssWidth = Math.max(Math.ceil(this.refs.mainScroller.clientWidth), 320)
    const cssHeight = RULER_HEIGHT

    canvas.width = Math.round(cssWidth * ratio)
    canvas.height = Math.round(cssHeight * ratio)
    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${cssHeight}px`

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    const totalFrames = Math.round(this.layout.totalDurationSec * this.layout.fps)
    drawTimeRuler(context, {
      startPx: this.refs.mainScroller.scrollLeft - TRACK_PADDING_LEFT,
      fps: this.layout.fps,
      scale: state.trackScale,
      totalFrames,
      width: cssWidth,
      height: cssHeight,
      ratio,
      palette: {
        bgColor: dark ? '#1f2937' : '#e5e7eb',
        longColor: dark ? '#cbd5e1' : '#374151',
        shortColor: dark ? '#94a3b8' : '#6b7280',
        textColor: dark ? '#e5e7eb' : '#374151',
        subTextColor: dark ? '#94a3b8' : '#6b7280',
        focusColor: dark ? '#312e81' : '#c4b5fd',
      },
    })
  }

  private renderTracks(state: TimelineState): void {
    const trackContentWidth = this.layout.totalDurationSec * this.layout.pixelsPerSecond + TRACK_PADDING_LEFT + TRACK_PADDING_RIGHT
    const timelineWidth = Math.max(trackContentWidth, this.refs.mainScroller.clientWidth || 640)
    const visibleRange = computeVisibleRange(
      this.refs.mainScroller.scrollLeft,
      this.refs.mainScroller.clientWidth || 640,
      this.layout.pixelsPerSecond,
      TRACK_PADDING_LEFT,
    )
    const alwaysIncludeIds = new Set<string>(state.selection.clipIds)
    for (const previewId of this.clipPreviewOverrides.keys()) {
      alwaysIncludeIds.add(previewId)
    }

    const visibleClipIds = new Set<string>()
    const rowElements: HTMLElement[] = this.layout.tracks.map(trackLayout =>
      this.renderTrackRow(state, trackLayout, timelineWidth, visibleRange, alwaysIncludeIds, visibleClipIds),
    )

    this.refs.tracksViewport.style.width = `${timelineWidth}px`
    this.refs.tracks.style.width = `${timelineWidth}px`
    this.refs.tracks.style.paddingTop = `${this.layout.contentTop}px`
    this.refs.tracks.style.paddingBottom = `${this.layout.contentBottom}px`
    this.refs.tracks.replaceChildren(...rowElements)
    this.refs.emptyState.style.display = this.layout.tracks.length === 0 ? 'flex' : 'none'

    this.pruneUnmountedClips(visibleClipIds)
  }

  private renderTrackRow(
    state: TimelineState,
    trackLayout: LayoutTrack,
    timelineWidth: number,
    visibleRange: ReturnType<typeof computeVisibleRange>,
    alwaysIncludeIds: ReadonlySet<string>,
    visibleClipIds: Set<string>,
  ): HTMLElement {
    const row = document.createElement('div')
    row.className = 'tk-track-row'
    row.style.height = `${trackLayout.height}px`
    row.style.marginLeft = `${TRACK_PADDING_LEFT}px`
    row.style.width = `${Math.max(0, timelineWidth - TRACK_PADDING_LEFT)}px`
    row.dataset.trackIndex = String(trackLayout.trackIndex)
    row.dataset.trackId = trackLayout.track.id

    const lane = document.createElement('div')
    lane.className = 'tk-track-lane'
    lane.style.width = `${Math.max(0, timelineWidth - TRACK_PADDING_LEFT)}px`

    const visibleClips = filterVisibleClips(trackLayout.clips, visibleRange, alwaysIncludeIds)
    for (const clipLayout of visibleClips) {
      visibleClipIds.add(clipLayout.clip.id)
      lane.appendChild(this.renderClip(state, clipLayout))
    }

    row.appendChild(lane)

    if (trackLayout.track.locked === true) {
      row.appendChild(this.renderTrackOverlay('已锁定', 'is-locked'))
    }
    else if (trackLayout.track.visible === false) {
      row.appendChild(this.renderTrackOverlay('已隐藏', 'is-hidden'))
    }
    else if (trackLayout.track.muted === true) {
      row.appendChild(this.renderTrackOverlay('已静音', 'is-muted'))
    }

    return row
  }

  private renderClip(state: TimelineState, clipLayout: LayoutClip): HTMLElement {
    const clip = clipLayout.clip
    const widthPx = Math.max(clipLayout.widthPx, MIN_CLIP_WIDTH_PX)
    const selectedSet = new Set(state.selection.clipIds)
    const isSelected = selectedSet.has(clip.id) || state.selection.clipId === clip.id
    const trackConfig = this.trackConfigs[clipLayout.type] ?? this.trackConfigs[clipLayout.track.type]

    const record = this.getOrCreateClipRecord(clip.id)
    const { clipNode, contentHost } = record

    clipNode.className = 'tk-track-clip'
    if (isSelected) {
      clipNode.classList.add('is-selected')
    }
    clipNode.style.left = `${clipLayout.leftPx}px`
    clipNode.style.width = `${widthPx}px`
    clipNode.style.transform = ''
    clipNode.dataset.clipId = clip.id
    clipNode.dataset.trackIndex = String(clipLayout.trackIndex)
    clipNode.dataset.clipIndex = String(clipLayout.clipIndex)
    clipNode.dataset.type = clipLayout.type

    const ctx: ClipRenderContext = {
      clip,
      track: clipLayout.track,
      trackIndex: clipLayout.trackIndex,
      clipIndex: clipLayout.clipIndex,
      isSelected,
      renderHints: state.renderHints,
      clipWidthPx: widthPx,
      isVisible: true,
    }

    const customSlot = trackConfig?.clip
    if (customSlot) {
      if (customSlot !== record.slotRef) {
        record.slotHandle?.destroy?.()
        record.mediaCleanups.forEach(fn => fn())
        record.mediaCleanups = []
        contentHost.replaceChildren()
        record.slotRef = customSlot
        record.slotHandle = normalizeSlotRenderer(customSlot).mount(contentHost, ctx) ?? undefined
      }
      else {
        record.slotHandle?.update?.(ctx)
      }
    }
    else {
      if (record.slotRef) {
        record.slotHandle?.destroy?.()
        record.slotHandle = undefined
        record.slotRef = undefined
        record.lastRenderKey = undefined
      }
      this.renderDefaultClipContent(record, ctx)
    }

    const previewOverride = this.clipPreviewOverrides.get(clip.id)
    if (previewOverride) {
      this.applyPreviewStyleToNode(clipNode, previewOverride, clipLayout.leftPx, widthPx)
    }

    return clipNode
  }

  private renderDefaultClipContent(record: MountedClipRecord, ctx: ClipRenderContext): void {
    const renderKey = [
      ctx.clip.type,
      ctx.clip.name,
      ctx.clip.resource ?? '',
      ctx.clip.startMs,
      ctx.clip.endMs,
      Math.round(ctx.clipWidthPx),
      ctx.renderHints.zoomActive ? '1' : '0',
      ctx.renderHints.settleVersion,
      this.mediaProvider ? 'mp' : 'nomp',
    ].join('|')

    if (record.lastRenderKey === renderKey) {
      return
    }
    record.lastRenderKey = renderKey

    record.mediaCleanups.forEach(fn => fn())
    record.mediaCleanups = []

    const { clip } = ctx
    const ratio = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1
    if (clip.type === 'video' || clip.type === 'audio') {
      const node = document.createElement('div')
      node.className = `tk-media-clip is-${clip.type}`

      const label = document.createElement('div')
      label.className = 'tk-media-clip-label'
      label.textContent = clip.name
      node.appendChild(label)

      const body = document.createElement('div')
      body.className = 'tk-media-clip-body'

      if (clip.type === 'video') {
        if (this.mediaProvider?.renderFilmstrip) {
          const filmstripHost = document.createElement('div')
          filmstripHost.className = 'tk-media-clip-filmstrip-host'
          const canvas = document.createElement('canvas')
          canvas.className = 'tk-media-clip-canvas'
          canvas.dataset.mediaRole = 'filmstrip'
          canvas.width = Math.max(1, Math.round(ctx.clipWidthPx * ratio))
          canvas.height = Math.max(1, Math.round(32 * ratio))
          filmstripHost.appendChild(canvas)
          body.appendChild(filmstripHost)
          const cleanup = this.mediaProvider.renderFilmstrip(canvas, ctx)
          if (typeof cleanup === 'function') {
            record.mediaCleanups.push(cleanup)
          }
        }
        else {
          const filmstrip = document.createElement('div')
          filmstrip.className = 'tk-media-clip-filmstrip'
          filmstrip.append(...createFilmstripPlaceholders())
          body.appendChild(filmstrip)
        }
      }

      const waveform = document.createElement('div')
      waveform.className = `tk-media-clip-waveform${clip.type === 'audio' ? ' is-audio-body' : ''}`
      if (this.mediaProvider?.renderWaveform) {
        const canvas = document.createElement('canvas')
        canvas.className = 'tk-media-clip-canvas'
        canvas.dataset.mediaRole = 'waveform'
        canvas.width = Math.max(1, Math.round(ctx.clipWidthPx * ratio))
        canvas.height = Math.max(1, Math.round((clip.type === 'audio' ? 38 : 14) * ratio))
        waveform.appendChild(canvas)
        const cleanup = this.mediaProvider.renderWaveform(canvas, ctx)
        if (typeof cleanup === 'function') {
          record.mediaCleanups.push(cleanup)
        }
      }
      else {
        const placeholder = document.createElement('span')
        placeholder.className = 'tk-media-clip-waveform-placeholder'
        waveform.appendChild(placeholder)
      }
      body.appendChild(waveform)

      node.appendChild(body)
      record.contentHost.replaceChildren(node)
      return
    }

    const node = document.createElement('div')
    node.className = 'tk-default-clip'
    node.dataset.type = clip.type

    const title = document.createElement('div')
    title.className = 'tk-default-clip-title'
    title.textContent = clip.name

    const meta = document.createElement('div')
    meta.className = 'tk-default-clip-meta'
    if (clip.trim || clip.durationMs) {
      const { offsetPercent, scalePercent } = getTrimOffset(clip)
      meta.textContent = `${clip.resource ?? ''} · trim ${offsetPercent.toFixed(0)}% / ${scalePercent.toFixed(0)}%`
    }
    else {
      meta.textContent = clip.resource || clip.type
    }

    node.append(title, meta)
    record.contentHost.replaceChildren(node)
  }

  private renderSelectionOnly(state: TimelineState): void {
    const selectedSet = new Set(state.selection.clipIds)
    for (const trackLayout of this.layout.tracks) {
      for (const clipLayout of trackLayout.clips) {
        const record = this.mountedClips.get(clipLayout.clip.id)
        if (!record) {
          continue
        }
        const isSelected = selectedSet.has(clipLayout.clip.id) || state.selection.clipId === clipLayout.clip.id
        record.clipNode.classList.toggle('is-selected', isSelected)
        if (record.slotRef) {
          record.slotHandle?.update?.({
            clip: clipLayout.clip,
            track: clipLayout.track,
            trackIndex: clipLayout.trackIndex,
            clipIndex: clipLayout.clipIndex,
            isSelected,
            renderHints: state.renderHints,
            clipWidthPx: Math.max(clipLayout.widthPx, MIN_CLIP_WIDTH_PX),
            isVisible: true,
          })
        }
      }
    }
  }

  private positionPlayhead(state: TimelineState): void {
    const currentTimeSec = frameToSeconds(state.currentFrame, this.layout.fps)
    const offsetPx = currentTimeSec * this.layout.pixelsPerSecond
    const scrollLeft = this.refs.mainScroller.scrollLeft
    this.refs.playhead.style.left = `${Math.max(0, TRACK_PADDING_LEFT + offsetPx - scrollLeft)}px`
  }

  private renderOverlay(): void {
    if (this.overlayState.verticalGuidelinePx == null) {
      this.refs.verticalGuideline.style.display = 'none'
    }
    else {
      this.refs.verticalGuideline.style.left = `${TRACK_PADDING_LEFT + this.overlayState.verticalGuidelinePx}px`
      this.refs.verticalGuideline.style.display = 'block'
    }

    if (this.overlayState.horizontalGuidelinePx == null) {
      this.refs.horizontalGuideline.style.display = 'none'
    }
    else {
      this.refs.horizontalGuideline.style.top = `${this.overlayState.horizontalGuidelinePx}px`
      this.refs.horizontalGuideline.style.display = 'block'
    }

    if (!this.overlayState.dragPreview) {
      this.refs.preview.style.display = 'none'
    }
    else {
      const p = this.overlayState.dragPreview
      this.refs.preview.style.left = `${TRACK_PADDING_LEFT + p.leftPx}px`
      this.refs.preview.style.top = `${p.topPx + 2}px`
      this.refs.preview.style.width = `${p.widthPx}px`
      this.refs.preview.style.height = `${Math.max(0, p.heightPx - 4)}px`
      this.refs.preview.textContent = p.label ?? '移动到此处'
      this.refs.preview.style.display = 'flex'
    }

    if (!this.overlayState.marqueeRect) {
      this.refs.marquee.style.display = 'none'
    }
    else {
      const m = this.overlayState.marqueeRect
      this.refs.marquee.style.left = `${TRACK_PADDING_LEFT + m.leftPx}px`
      this.refs.marquee.style.top = `${m.topPx}px`
      this.refs.marquee.style.width = `${m.widthPx}px`
      this.refs.marquee.style.height = `${m.heightPx}px`
      this.refs.marquee.style.display = 'block'
    }
  }

  private applyClipPreview(clipId: string): void {
    const record = this.mountedClips.get(clipId)
    if (!record) {
      return
    }
    const layoutClip = this.findLayoutClip(clipId)
    const baseLeft = layoutClip?.leftPx ?? 0
    const baseWidth = Math.max(layoutClip?.widthPx ?? MIN_CLIP_WIDTH_PX, MIN_CLIP_WIDTH_PX)
    const override = this.clipPreviewOverrides.get(clipId)

    if (!override) {
      record.clipNode.style.left = `${baseLeft}px`
      record.clipNode.style.width = `${baseWidth}px`
      record.clipNode.style.transform = ''
      record.clipNode.classList.remove('is-dragging', 'is-trimming')
      return
    }

    this.applyPreviewStyleToNode(record.clipNode, override, baseLeft, baseWidth)
  }

  private applyPreviewStyleToNode(
    clipNode: HTMLElement,
    override: ClipPreviewOverride,
    baseLeft: number,
    baseWidth: number,
  ): void {
    clipNode.style.left = `${override.leftPx ?? baseLeft}px`
    clipNode.style.width = `${override.widthPx ?? baseWidth}px`

    const tx = override.translateX ?? 0
    const ty = override.translateY ?? 0
    clipNode.style.transform = (tx !== 0 || ty !== 0) ? `translate(${tx}px, ${ty}px)` : ''
    clipNode.classList.toggle('is-dragging', override.isDragging === true)
    clipNode.classList.toggle('is-trimming', override.isTrimming === true)
  }

  private findLayoutClip(clipId: string): LayoutClip | null {
    for (const track of this.layout.tracks) {
      for (const clip of track.clips) {
        if (clip.clip.id === clipId) {
          return clip
        }
      }
    }
    return null
  }

  private getOrCreateClipRecord(clipId: string): MountedClipRecord {
    const existing = this.mountedClips.get(clipId)
    if (existing) {
      return existing
    }

    const clipNode = document.createElement('div')
    clipNode.className = 'tk-track-clip'

    const contentHost = document.createElement('div')
    contentHost.className = 'tk-track-clip-content'

    const selectionFrame = document.createElement('div')
    selectionFrame.className = 'tk-track-clip-selection-frame'

    const leftHandle = document.createElement('div')
    leftHandle.className = 'tk-track-clip-handle is-left'
    leftHandle.dataset.trimEdge = 'start'
    leftHandle.textContent = '|'

    const rightHandle = document.createElement('div')
    rightHandle.className = 'tk-track-clip-handle is-right'
    rightHandle.dataset.trimEdge = 'end'
    rightHandle.textContent = '|'

    clipNode.append(contentHost, selectionFrame, leftHandle, rightHandle)

    const record: MountedClipRecord = {
      clipId,
      clipNode,
      contentHost,
      selectionFrame,
      leftHandle,
      rightHandle,
      mediaCleanups: [],
    }
    this.mountedClips.set(clipId, record)
    return record
  }

  private pruneUnmountedClips(visibleClipIds: ReadonlySet<string>): void {
    for (const [clipId, record] of this.mountedClips.entries()) {
      if (!visibleClipIds.has(clipId)) {
        record.slotHandle?.destroy?.()
        record.mediaCleanups.forEach(fn => fn())
        record.clipNode.remove()
        this.mountedClips.delete(clipId)
      }
    }
  }

  private renderTrackOverlay(text: string, variant: string): HTMLElement {
    const overlay = document.createElement('div')
    overlay.className = `tk-track-overlay ${variant}`
    const badge = document.createElement('div')
    badge.className = 'tk-track-overlay-badge'
    badge.textContent = text
    overlay.appendChild(badge)
    return overlay
  }
}
