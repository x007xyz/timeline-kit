import { cloneDocument, resolveSelection } from '../model/operations'
import type { TimelineDocument, TimelineSelection } from '../model/types'
import { clampTrackScale } from '../engine/timeScale'
import type {
  HistoryMode,
  RenderChannel,
  ThemeMode,
  TimelineRenderHints,
  TimelineState,
  TimelineStateChange,
  TimelineStoreLike,
} from './types'

export interface TimelineStoreOptions {
  document: TimelineDocument
  currentFrame?: number
  trackScale?: number
  isMagnetEnabled?: boolean
  renderHints?: Partial<TimelineRenderHints>
  theme?: ThemeMode
  historyMode?: HistoryMode
  maxHistory?: number
}

const DEFAULT_RENDER_HINTS: TimelineRenderHints = {
  zoomActive: false,
  settleVersion: 0,
}

const ALL_DATA_CHANNELS: readonly RenderChannel[] = [
  'tracks',
  'sidebar',
  'ruler',
  'toolbar',
  'selection',
  'playhead',
]

function selectionsEqual(a: TimelineSelection, b: TimelineSelection): boolean {
  if (a.clipId !== b.clipId || a.trackIndex !== b.trackIndex || a.clipIndex !== b.clipIndex) {
    return false
  }
  if (a.clipIds.length !== b.clipIds.length) {
    return false
  }
  for (let index = 0; index < a.clipIds.length; index += 1) {
    if (a.clipIds[index] !== b.clipIds[index]) {
      return false
    }
  }
  return true
}

export class TimelineStore implements TimelineStoreLike {
  private state: TimelineState
  private historyMode: HistoryMode
  private readonly maxHistory: number
  private historyPast: TimelineDocument[]
  private historyFuture: TimelineDocument[]
  private externalCanUndo: boolean
  private externalCanRedo: boolean
  private readonly listeners: Set<(change: TimelineStateChange) => void>

  constructor(options: TimelineStoreOptions) {
    const initialDoc = cloneDocument(options.document)
    this.historyMode = options.historyMode ?? 'internal'
    this.maxHistory = options.maxHistory ?? 50
    this.historyPast = []
    this.historyFuture = []
    this.externalCanUndo = false
    this.externalCanRedo = false
    this.listeners = new Set()

    this.state = {
      document: initialDoc,
      currentFrame: Math.max(0, Math.round(options.currentFrame ?? 0)),
      trackScale: clampTrackScale(options.trackScale ?? 50),
      isMagnetEnabled: options.isMagnetEnabled ?? false,
      selection: {
        trackIndex: -1,
        clipIndex: -1,
        clipId: null,
        clipIds: [],
      },
      canUndo: false,
      canRedo: false,
      renderHints: {
        ...DEFAULT_RENDER_HINTS,
        ...(options.renderHints ?? {}),
      },
      theme: options.theme ?? 'auto',
    }
  }

  getState(): TimelineState {
    return this.state
  }

  getSnapshot(): TimelineState {
    return {
      ...this.state,
      document: cloneDocument(this.state.document),
      selection: {
        ...this.state.selection,
        clipIds: [...this.state.selection.clipIds],
      },
      renderHints: { ...this.state.renderHints },
    }
  }

  getHistoryMode(): HistoryMode {
    return this.historyMode
  }

  setHistoryMode(mode: HistoryMode): void {
    if (this.historyMode === mode) {
      return
    }
    this.historyMode = mode
    if (mode === 'external') {
      this.historyPast = []
      this.historyFuture = []
    }
    this.commitState(
      {
        ...this.state,
        canUndo: this.computeCanUndo(),
        canRedo: this.computeCanRedo(),
      },
      ['toolbar'],
    )
  }

  setExternalHistoryState(flags: { canUndo?: boolean, canRedo?: boolean }): void {
    if (this.historyMode !== 'external') {
      return
    }
    const nextUndo = flags.canUndo ?? this.externalCanUndo
    const nextRedo = flags.canRedo ?? this.externalCanRedo
    if (nextUndo === this.externalCanUndo && nextRedo === this.externalCanRedo) {
      return
    }
    this.externalCanUndo = nextUndo
    this.externalCanRedo = nextRedo
    this.commitState(
      {
        ...this.state,
        canUndo: this.externalCanUndo,
        canRedo: this.externalCanRedo,
      },
      ['toolbar'],
    )
  }

  setDocument(
    doc: TimelineDocument,
    options?: {
      pushHistory?: boolean
      dirty?: readonly RenderChannel[]
      selectionClipIds?: readonly string[]
      primaryClipId?: string | null
    },
  ): boolean {
    const shouldPushHistory = options?.pushHistory === true && this.historyMode === 'internal'
    if (shouldPushHistory) {
      this.pushHistorySnapshot(this.state.document)
    }

    const nextDoc = cloneDocument(doc)
    const targetClipIds = options?.selectionClipIds ?? this.state.selection.clipIds
    const targetPrimary = options?.primaryClipId !== undefined
      ? options.primaryClipId
      : this.state.selection.clipId
    const nextSelection = resolveSelection(nextDoc, targetClipIds, targetPrimary)

    this.commitState(
      {
        ...this.state,
        document: nextDoc,
        selection: nextSelection,
        canUndo: this.computeCanUndo(),
        canRedo: this.computeCanRedo(),
      },
      options?.dirty ?? ALL_DATA_CHANNELS,
    )
    return true
  }

  setCurrentFrame(frame: number): boolean {
    const nextFrame = Math.max(0, Math.round(frame))
    if (!Number.isFinite(nextFrame) || nextFrame === this.state.currentFrame) {
      return false
    }

    this.commitState(
      {
        ...this.state,
        currentFrame: nextFrame,
      },
      ['playhead'],
    )
    return true
  }

  setTrackScale(scale: number, renderHints?: Partial<TimelineRenderHints>): boolean {
    const nextScale = clampTrackScale(scale)
    const nextHints = renderHints
      ? { ...this.state.renderHints, ...renderHints }
      : this.state.renderHints

    const scaleChanged = nextScale !== this.state.trackScale
    const hintsChanged = nextHints.zoomActive !== this.state.renderHints.zoomActive
      || nextHints.settleVersion !== this.state.renderHints.settleVersion

    if (!scaleChanged && !hintsChanged) {
      return false
    }

    this.commitState(
      {
        ...this.state,
        trackScale: nextScale,
        renderHints: nextHints,
      },
      ['ruler', 'tracks', 'playhead', 'toolbar'],
    )
    return true
  }

  setRenderHints(hints: Partial<TimelineRenderHints>): boolean {
    const nextHints = {
      ...this.state.renderHints,
      ...hints,
    }
    if (
      nextHints.zoomActive === this.state.renderHints.zoomActive
      && nextHints.settleVersion === this.state.renderHints.settleVersion
    ) {
      return false
    }

    this.commitState(
      {
        ...this.state,
        renderHints: nextHints,
      },
      ['tracks'],
    )
    return true
  }

  setTheme(theme: ThemeMode): boolean {
    if (theme === this.state.theme) {
      return false
    }

    this.commitState(
      {
        ...this.state,
        theme,
      },
      ['toolbar', 'sidebar', 'ruler', 'tracks'],
    )
    return true
  }

  setMagnetEnabled(enabled: boolean): boolean {
    if (enabled === this.state.isMagnetEnabled) {
      return false
    }

    this.commitState(
      {
        ...this.state,
        isMagnetEnabled: enabled,
      },
      ['toolbar'],
    )
    return true
  }

  toggleMagnetEnabled(): boolean {
    return this.setMagnetEnabled(!this.state.isMagnetEnabled)
  }

  setSelection(clipIds: readonly string[], primaryClipId?: string | null): boolean {
    const nextSelection = resolveSelection(
      this.state.document,
      clipIds,
      primaryClipId ?? clipIds[0] ?? null,
    )
    if (selectionsEqual(this.state.selection, nextSelection)) {
      return false
    }

    this.commitState(
      {
        ...this.state,
        selection: nextSelection,
      },
      ['selection', 'toolbar'],
    )
    return true
  }

  clearSelection(): boolean {
    if (this.state.selection.clipId === null && this.state.selection.clipIds.length === 0) {
      return false
    }

    this.commitState(
      {
        ...this.state,
        selection: {
          trackIndex: -1,
          clipIndex: -1,
          clipId: null,
          clipIds: [],
        },
      },
      ['selection', 'toolbar'],
    )
    return true
  }

  undo(): boolean {
    if (this.historyMode !== 'internal') {
      return false
    }

    const previous = this.historyPast.pop()
    if (!previous) {
      return false
    }

    this.historyFuture.push(cloneDocument(this.state.document))
    const nextSelection = resolveSelection(
      previous,
      this.state.selection.clipIds,
      this.state.selection.clipId,
    )

    this.commitState(
      {
        ...this.state,
        document: previous,
        selection: nextSelection,
        canUndo: this.computeCanUndo(),
        canRedo: this.computeCanRedo(),
      },
      ALL_DATA_CHANNELS,
    )
    return true
  }

  redo(): boolean {
    if (this.historyMode !== 'internal') {
      return false
    }

    const next = this.historyFuture.pop()
    if (!next) {
      return false
    }

    this.historyPast.push(cloneDocument(this.state.document))
    const nextSelection = resolveSelection(
      next,
      this.state.selection.clipIds,
      this.state.selection.clipId,
    )

    this.commitState(
      {
        ...this.state,
        document: next,
        selection: nextSelection,
        canUndo: this.computeCanUndo(),
        canRedo: this.computeCanRedo(),
      },
      ALL_DATA_CHANNELS,
    )
    return true
  }

  subscribe(listener: (change: TimelineStateChange) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  subscribeSelector<TSelected>(
    selector: (state: TimelineState) => TSelected,
    listener: (selected: TSelected, prevSelected: TSelected) => void,
    isEqual: (a: TSelected, b: TSelected) => boolean = Object.is,
  ): () => void {
    let currentSelected = selector(this.state)
    return this.subscribe(({ state }) => {
      const nextSelected = selector(state)
      if (!isEqual(currentSelected, nextSelected)) {
        const previous = currentSelected
        currentSelected = nextSelected
        listener(nextSelected, previous)
      }
    })
  }

  private computeCanUndo(): boolean {
    return this.historyMode === 'internal'
      ? this.historyPast.length > 0
      : this.externalCanUndo
  }

  private computeCanRedo(): boolean {
    return this.historyMode === 'internal'
      ? this.historyFuture.length > 0
      : this.externalCanRedo
  }

  private pushHistorySnapshot(doc: TimelineDocument): void {
    this.historyPast.push(cloneDocument(doc))
    if (this.historyPast.length > this.maxHistory) {
      this.historyPast.shift()
    }
    this.historyFuture = []
  }

  private commitState(nextState: TimelineState, dirtyList: readonly RenderChannel[]): void {
    const prevState = this.state
    this.state = nextState
    const dirty = new Set<RenderChannel>(dirtyList)
    const change: TimelineStateChange = {
      state: nextState,
      prevState,
      dirty,
    }
    this.listeners.forEach((listener) => {
      listener(change)
    })
  }
}
