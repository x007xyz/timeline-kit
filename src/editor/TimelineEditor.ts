import type { Timeline as OtioTimeline } from '../otio-core'
import { fromOtioTimeline, isOtioTimeline, toOtioTimeline } from '../adapters/otio'
import { getPixelsPerSecond, msToPx } from '../engine/timeScale'
import { cloneDocument } from '../model/operations'
import { DEFAULT_EDIT_POLICIES, type EditPolicies, type TimelineDocument } from '../model/types'
import { createDefaultPlugins, InteractionManager, type TimelinePlugin } from '../plugins'
import { DomTimelineRenderer } from '../renderer/domRenderer'
import type { MediaProvider, ToolbarConfig, TrackConfigMap, UIConfig } from '../renderer/types'
import { CommandBus, registerBuiltinCommands, TimelineStore } from '../store'
import type {
  BeforeCommandHook,
  CommandSpec,
  HistoryMode,
  ThemeMode,
  TimelineCommand,
  TimelineRenderHints,
  TimelineState,
  TimelineStateChange,
} from '../store/types'
import type { TimelineEditorOptions, TimelineEditorSnapshot, TimelineSelectionInput } from './types'

function resolveInitialDocument(options: TimelineEditorOptions): TimelineDocument {
  const source = options.document ?? options.timeline
  let doc: TimelineDocument
  if (!source) {
    doc = {
      id: 'timeline-kit',
      name: 'Timeline',
      fps: options.fps ?? 24,
      tracks: [],
    }
  }
  else if (isOtioTimeline(source)) {
    doc = fromOtioTimeline(source)
  }
  else {
    doc = cloneDocument(source)
  }

  if (typeof options.fps === 'number' && options.fps > 0 && !options.document && !isOtioTimeline(options.timeline)) {
    doc.fps = options.fps
  }
  else if (typeof options.fps === 'number' && options.fps > 0 && doc.fps <= 0) {
    doc.fps = options.fps
  }

  return doc
}

function resolveUIConfig(options: TimelineEditorOptions): UIConfig {
  const ui: UIConfig = { ...(options.ui ?? {}) }
  if (ui.toolbar === undefined && options.toolsConfigs !== undefined) {
    ui.toolbar = options.toolsConfigs
  }
  return ui
}

/**
 * Window-level keyboard routing across editor instances. When focus is not inside
 * any editor (e.g. on <body>), only the editor the user last interacted with
 * handles shortcuts, so several editors on one page never react to one key press.
 */
const liveEditors = new Set<TimelineEditor>()
let activeEditor: TimelineEditor | null = null

export class TimelineEditor extends EventTarget {
  private readonly container: HTMLElement
  private readonly store: TimelineStore
  private readonly commands: CommandBus
  private readonly renderer: DomTimelineRenderer
  private readonly interactions: InteractionManager
  private policies: EditPolicies
  private uiConfig: UIConfig
  private resizeObserver: ResizeObserver | null
  private destroyed: boolean

  private readonly onPointerDownRef: (event: PointerEvent) => void
  private readonly onFocusInRef: () => void
  private readonly onPointerMoveRef: (event: PointerEvent) => void
  private readonly onPointerUpRef: (event: PointerEvent) => void
  private readonly onPointerCancelRef: () => void
  private readonly onWheelRef: (event: WheelEvent) => void
  private readonly onClickRef: (event: MouseEvent) => void
  private readonly onInputRef: (event: Event) => void
  private readonly onScrollRef: () => void
  private readonly onDragOverRef: (event: DragEvent) => void
  private readonly onDragLeaveRef: () => void
  private readonly onDropRef: (event: DragEvent) => void
  private readonly onKeyDownRef: (event: KeyboardEvent) => void
  private readonly onKeyUpRef: (event: KeyboardEvent) => void
  private readonly onWindowResizeRef: () => void
  private readonly unsubscribeStore: () => void
  private readonly unsubscribeAfterCommand: () => void

  constructor(container: HTMLElement, options: TimelineEditorOptions = {}) {
    super()
    this.container = container
    this.destroyed = false
    this.resizeObserver = null
    this.policies = {
      ...DEFAULT_EDIT_POLICIES,
      ...(options.policies ?? {}),
    }
    this.uiConfig = resolveUIConfig(options)

    const initialDoc = resolveInitialDocument(options)
    this.store = new TimelineStore({
      document: initialDoc,
      currentFrame: options.currentFrame,
      trackScale: options.trackScale,
      isMagnetEnabled: options.isMagnetEnabled,
      renderHints: options.renderHints,
      theme: options.theme ?? 'auto',
      historyMode: options.history ?? 'internal',
    })

    this.renderer = new DomTimelineRenderer(container, {
      trackConfigs: options.trackConfigs,
      ui: this.uiConfig,
      theme: options.theme ?? 'auto',
      injectStyles: options.injectStyles,
      mediaProvider: options.mediaProvider,
    })

    this.commands = new CommandBus({
      store: this.store,
      getPolicies: () => this.policies,
      fitToView: () => this.computeFitToViewScale(),
    })
    registerBuiltinCommands(this.commands)

    if (options.onBeforeCommand) {
      this.commands.addBeforeHook(options.onBeforeCommand)
    }

    this.interactions = new InteractionManager({
      store: this.store,
      commands: this.commands,
      renderer: this.renderer,
      getPolicies: () => this.policies,
    })

    if (!options.disableDefaultPlugins) {
      const defaults = createDefaultPlugins({ shortcuts: options.shortcuts })
      for (const plugin of defaults) {
        this.interactions.use(plugin)
      }
    }

    if (options.keymap) {
      for (const [chord, binding] of Object.entries(options.keymap)) {
        this.interactions.setKeyBinding(chord, binding)
      }
    }

    if (options.plugins) {
      for (const plugin of options.plugins) {
        this.interactions.use(plugin)
      }
    }

    this.unsubscribeStore = this.store.subscribe((change) => {
      this.handleStateChange(change)
    })

    this.unsubscribeAfterCommand = this.commands.addAfterHook((command, executed) => {
      if (executed) {
        this.emitCommandEvent(command)
      }
    })

    this.onPointerDownRef = event => this.onPointerDown(event)
    this.onPointerMoveRef = event => this.onPointerMove(event)
    this.onPointerUpRef = event => this.onPointerUp(event)
    this.onPointerCancelRef = () => {
      this.interactions.cancelActiveSession()
    }
    this.onWheelRef = event => this.onWheel(event)
    this.onClickRef = event => this.onClick(event)
    this.onInputRef = event => this.onInput(event)
    this.onScrollRef = () => this.renderer.handleScroll()
    this.onDragOverRef = event => this.onDragOver(event)
    this.onDragLeaveRef = () => this.interactions.handleDragLeave()
    this.onDropRef = event => this.onDrop(event)
    this.onKeyDownRef = event => this.onKeyDown(event)
    this.onFocusInRef = () => this.markActive()
    this.onKeyUpRef = event => this.onKeyUp(event)
    this.onWindowResizeRef = () => this.resize()

    this.renderer.render(this.store.getState())
    this.bindEvents()
  }

  getDocument(): TimelineDocument {
    return cloneDocument(this.store.getState().document)
  }

  setDocument(doc: TimelineDocument, options?: { pushHistory?: boolean }): void {
    this.store.setDocument(doc, { pushHistory: options?.pushHistory ?? false })
  }

  getTimeline(): TimelineDocument {
    return this.getDocument()
  }

  setTimeline(timeline: TimelineDocument | OtioTimeline, options?: { pushHistory?: boolean }): void {
    const doc = isOtioTimeline(timeline) ? fromOtioTimeline(timeline) : timeline
    this.store.setDocument(doc, { pushHistory: options?.pushHistory ?? false })
  }

  getOtioTimeline(): OtioTimeline {
    return toOtioTimeline(this.store.getState().document)
  }

  getCurrentFrame(): number {
    return this.store.getState().currentFrame
  }

  setCurrentFrame(frame: number): void {
    this.store.setCurrentFrame(frame)
  }

  getTrackScale(): number {
    return this.store.getState().trackScale
  }

  setTrackScale(scale: number, renderHints?: Partial<TimelineRenderHints>): void {
    this.store.setTrackScale(scale, renderHints)
  }

  fitToView(): number | null {
    const scale = this.computeFitToViewScale()
    if (scale !== null) {
      this.store.setTrackScale(scale)
    }
    return scale
  }

  scrollToTime(ms: number): void {
    const state = this.store.getState()
    const pps = getPixelsPerSecond(state.trackScale, state.document.fps)
    const targetPx = Math.max(0, msToPx(ms, pps))
    this.renderer.setScrollLeft(targetPx)
  }

  setSelection(selection: TimelineSelectionInput): void {
    if (selection === null) {
      this.store.clearSelection()
      return
    }
    if (typeof selection === 'string') {
      this.store.setSelection([selection], selection)
      return
    }
    if (Array.isArray(selection)) {
      this.store.setSelection(selection, selection[0] ?? null)
      return
    }
    const ids = selection.clipIds ?? (selection.clipId ? [selection.clipId] : [])
    this.store.setSelection(ids, selection.clipId ?? ids[0] ?? null)
  }

  clearSelection(): void {
    this.store.clearSelection()
  }

  setMagnetEnabled(enabled: boolean): void {
    this.commands.execute('magnet:set', { enabled })
  }

  setHistoryMode(mode: HistoryMode): void {
    this.store.setHistoryMode(mode)
  }

  setExternalHistoryState(flags: { canUndo?: boolean, canRedo?: boolean }): void {
    this.store.setExternalHistoryState(flags)
  }

  setTrackConfigs(trackConfigs: TrackConfigMap | undefined): void {
    this.renderer.setTrackConfigs(trackConfigs ?? {})
    this.renderer.render(this.store.getState(), new Set(['tracks', 'sidebar', 'playhead']))
  }

  setToolsConfigs(toolsConfigs: ToolbarConfig[] | undefined): void {
    this.uiConfig = {
      ...this.uiConfig,
      toolbar: toolsConfigs ?? true,
    }
    this.renderer.setUIConfig(this.uiConfig)
    this.renderer.render(this.store.getState(), new Set(['toolbar']))
  }

  setUI(ui: UIConfig): void {
    this.uiConfig = { ...ui }
    this.renderer.setUIConfig(this.uiConfig)
    this.renderer.render(this.store.getState(), new Set(['toolbar', 'sidebar', 'ruler', 'tracks', 'playhead']))
  }

  setTheme(theme: ThemeMode): void {
    this.store.setTheme(theme)
  }

  setPolicies(policies: Partial<EditPolicies>): void {
    this.policies = {
      ...this.policies,
      ...policies,
    }
  }

  setRenderHints(renderHints: Partial<TimelineRenderHints>): void {
    this.store.setRenderHints(renderHints)
  }

  setMediaProvider(provider: MediaProvider | undefined): void {
    this.renderer.setMediaProvider(provider)
    this.renderer.render(this.store.getState(), new Set(['tracks']))
  }

  exec(command: string, payload?: unknown): boolean {
    return this.commands.execute(command, payload)
  }

  canExecute(command: string, payload?: unknown): boolean {
    return this.commands.canExecute(command, payload)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- public default kept for API compatibility
  registerCommand<TPayload = any>(type: string, spec: CommandSpec<TPayload>): () => void {
    return this.commands.register(type, spec)
  }

  onBeforeCommand(hook: BeforeCommandHook): () => void {
    return this.commands.addBeforeHook(hook)
  }

  use(plugin: TimelinePlugin): () => void {
    return this.interactions.use(plugin)
  }

  removePlugin(name: string): boolean {
    return this.interactions.remove(name)
  }

  getState(): TimelineState {
    return this.store.getState()
  }

  getSnapshot(): TimelineEditorSnapshot {
    return this.store.getSnapshot()
  }

  subscribe(listener: (change: TimelineStateChange) => void): () => void {
    return this.store.subscribe(listener)
  }

  subscribeSelector<TSelected>(
    selector: (state: TimelineState) => TSelected,
    listener: (selected: TSelected, prevSelected: TSelected) => void,
    isEqual?: (a: TSelected, b: TSelected) => boolean,
  ): () => void {
    return this.store.subscribeSelector(selector, listener, isEqual)
  }

  resize(): void {
    if (this.destroyed) {
      return
    }
    this.renderer.clearOverlay()
    this.renderer.render(this.store.getState(), new Set(['ruler', 'tracks', 'sidebar', 'playhead']))
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    this.unbindEvents()
    this.interactions.destroy()
    this.unsubscribeStore()
    this.unsubscribeAfterCommand()
    this.renderer.destroy()
  }

  private bindEvents(): void {
    const root = this.renderer.getRootElement()
    const scroller = this.renderer.getMainScrollerElement()

    root.addEventListener('pointerdown', this.onPointerDownRef)
    root.addEventListener('focusin', this.onFocusInRef)
    liveEditors.add(this)
    root.addEventListener('click', this.onClickRef)
    root.addEventListener('input', this.onInputRef)
    root.addEventListener('wheel', this.onWheelRef, { passive: false })
    root.addEventListener('dragover', this.onDragOverRef)
    root.addEventListener('dragleave', this.onDragLeaveRef)
    root.addEventListener('drop', this.onDropRef)
    scroller.addEventListener('scroll', this.onScrollRef)

    window.addEventListener('pointermove', this.onPointerMoveRef)
    window.addEventListener('pointerup', this.onPointerUpRef)
    window.addEventListener('pointercancel', this.onPointerCancelRef)
    window.addEventListener('keydown', this.onKeyDownRef)
    window.addEventListener('keyup', this.onKeyUpRef)
    window.addEventListener('resize', this.onWindowResizeRef)

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.resize()
      })
      this.resizeObserver.observe(this.container)
    }
  }

  private unbindEvents(): void {
    const root = this.renderer.getRootElement()
    const scroller = this.renderer.getMainScrollerElement()

    root.removeEventListener('pointerdown', this.onPointerDownRef)
    root.removeEventListener('focusin', this.onFocusInRef)
    liveEditors.delete(this)
    if (activeEditor === this) {
      activeEditor = null
    }
    root.removeEventListener('click', this.onClickRef)
    root.removeEventListener('input', this.onInputRef)
    root.removeEventListener('wheel', this.onWheelRef)
    root.removeEventListener('dragover', this.onDragOverRef)
    root.removeEventListener('dragleave', this.onDragLeaveRef)
    root.removeEventListener('drop', this.onDropRef)
    scroller.removeEventListener('scroll', this.onScrollRef)

    window.removeEventListener('pointermove', this.onPointerMoveRef)
    window.removeEventListener('pointerup', this.onPointerUpRef)
    window.removeEventListener('pointercancel', this.onPointerCancelRef)
    window.removeEventListener('keydown', this.onKeyDownRef)
    window.removeEventListener('keyup', this.onKeyUpRef)
    window.removeEventListener('resize', this.onWindowResizeRef)

    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }
  }

  private handleStateChange(change: TimelineStateChange): void {
    if (this.destroyed) {
      return
    }

    this.renderer.render(change.state, change.dirty)

    const { state, prevState } = change
    if (state.document !== prevState.document) {
      this.emitStateEvent('documentchange')
      this.emitStateEvent('timelinechange')
    }
    if (state.selection !== prevState.selection) {
      this.emitStateEvent('selectionchange')
    }
    if (state.currentFrame !== prevState.currentFrame) {
      this.emitStateEvent('currentframechange')
    }
    if (state.trackScale !== prevState.trackScale) {
      this.emitStateEvent('trackscalechange')
    }
    if (state.isMagnetEnabled !== prevState.isMagnetEnabled) {
      this.emitStateEvent('magnetchange')
    }
  }

  private emitStateEvent(type: string): void {
    this.dispatchEvent(new CustomEvent(type, {
      detail: this.getSnapshot(),
    }))
  }

  private emitCommandEvent(command: TimelineCommand): void {
    this.dispatchEvent(new CustomEvent('command', {
      detail: {
        command,
        snapshot: this.getSnapshot(),
      },
    }))
  }

  private markActive(): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- module-level registry of the active instance
    activeEditor = this
  }

  private onPointerDown(event: PointerEvent): void {
    this.markActive()
    const doc = this.store.getState().document
    const hit = this.renderer.hitTestClientPoint(event.clientX, event.clientY, event.target, doc)
    this.interactions.handlePointerDown({
      originalEvent: event,
      hit,
      clientX: event.clientX,
      clientY: event.clientY,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      button: event.button,
    })
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.interactions.hasActiveSession()) {
      return
    }
    const doc = this.store.getState().document
    const hit = this.renderer.hitTestClientPoint(event.clientX, event.clientY, event.target, doc)
    this.interactions.handlePointerMove({
      originalEvent: event,
      hit,
      clientX: event.clientX,
      clientY: event.clientY,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      button: event.button,
    })
  }

  private onPointerUp(event: PointerEvent): void {
    if (!this.interactions.hasActiveSession()) {
      return
    }
    const doc = this.store.getState().document
    const hit = this.renderer.hitTestClientPoint(event.clientX, event.clientY, event.target, doc)
    this.interactions.handlePointerUp({
      originalEvent: event,
      hit,
      clientX: event.clientX,
      clientY: event.clientY,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      button: event.button,
    })
  }

  private onWheel(event: WheelEvent): void {
    const doc = this.store.getState().document
    const hit = this.renderer.hitTestClientPoint(event.clientX, event.clientY, event.target, doc)
    this.interactions.handleWheel({
      originalEvent: event,
      hit,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    })
  }

  private onDragOver(event: DragEvent): void {
    const doc = this.store.getState().document
    const hit = this.renderer.hitTestClientPoint(event.clientX, event.clientY, event.target, doc)
    this.interactions.handleDragOver({
      originalEvent: event,
      hit,
      dataTransfer: event.dataTransfer,
    })
  }

  private onDrop(event: DragEvent): void {
    const doc = this.store.getState().document
    const hit = this.renderer.hitTestClientPoint(event.clientX, event.clientY, event.target, doc)
    this.interactions.handleDrop({
      originalEvent: event,
      hit,
      dataTransfer: event.dataTransfer,
    })
  }

  private onClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null
    if (!target) {
      return
    }

    const trackButton = target.closest('[data-track-command]') as HTMLButtonElement | null
    if (trackButton) {
      const flag = trackButton.dataset.trackCommand as 'locked' | 'muted' | 'visible' | undefined
      const trackIndex = Number(trackButton.dataset.trackIndex ?? -1)
      if (flag && trackIndex >= 0) {
        this.commands.execute('track:toggle-flag', { trackIndex, flag })
        this.renderer.focusContainer()
      }
      return
    }

    const button = target.closest('[data-command]') as HTMLButtonElement | null
    if (!button) {
      return
    }
    const command = button.dataset.command
    if (!command) {
      return
    }

    this.commands.execute(command)
    this.renderer.focusContainer()
  }

  private onInput(event: Event): void {
    const target = event.target instanceof HTMLInputElement ? event.target : null
    if (!target || target.dataset.command !== 'track-scale') {
      return
    }

    const value = Number(target.value)
    if (Number.isFinite(value)) {
      this.commands.execute('scale:set', { scale: value })
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.shouldHandleWindowKeyEvent()) {
      return
    }
    this.interactions.handleKeyDown(event)
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (!this.shouldHandleWindowKeyEvent()) {
      return
    }
    this.interactions.handleKeyUp(event)
  }

  private shouldHandleWindowKeyEvent(): boolean {
    if (this.interactions.hasActiveSession()) {
      return true
    }
    const root = this.renderer.getRootElement()
    const active = typeof document !== 'undefined' ? document.activeElement : null
    if (active && root.contains(active)) {
      return true
    }
    if (!active || active === document.body || active === document.documentElement) {
      // Focus is nowhere in particular: route to the last-used editor, or to the
      // only editor on the page if none has been used yet.
      return activeEditor ? activeEditor === this : liveEditors.size === 1
    }
    return false
  }

  private computeFitToViewScale(): number | null {
    const state = this.store.getState()
    const layout = this.renderer.getLayout()
    const metrics = this.renderer.getViewportMetrics()
    const totalDurationMs = Math.max(layout.totalDurationMs, 1)
    const availableWidth = Math.max(metrics.clientWidth * 0.9, 320)
    const candidateScales = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0]

    for (const scale of candidateScales) {
      const pps = getPixelsPerSecond(scale, state.document.fps)
      if (msToPx(totalDurationMs, pps) <= availableWidth) {
        return scale
      }
    }

    return 0
  }
}

export function createTimelineEditor(
  container: HTMLElement,
  options: TimelineEditorOptions = {},
): TimelineEditor {
  return new TimelineEditor(container, options)
}
