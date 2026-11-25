import type { EditPolicies, TimelineDocument, TimelineSelection } from '../model/types'

export type RenderChannel
  = | 'toolbar'
    | 'sidebar'
    | 'ruler'
    | 'tracks'
    | 'selection'
    | 'playhead'
    | 'overlay'

export interface TimelineRenderHints {
  zoomActive: boolean
  settleVersion: number
}

export type ThemeMode = 'light' | 'dark' | 'auto'

export type HistoryMode = 'internal' | 'external'

export interface TimelineState {
  document: TimelineDocument
  currentFrame: number
  trackScale: number
  isMagnetEnabled: boolean
  selection: TimelineSelection
  canUndo: boolean
  canRedo: boolean
  renderHints: TimelineRenderHints
  theme: ThemeMode
}

export interface TimelineStateChange {
  state: TimelineState
  prevState: TimelineState
  dirty: ReadonlySet<RenderChannel>
}

export interface TimelineCommand<TPayload = unknown> {
  type: string
  payload?: TPayload
}

export interface TimelineStoreLike {
  getState: () => TimelineState
  getSnapshot: () => TimelineState
  setDocument: (
    doc: TimelineDocument,
    options?: {
      pushHistory?: boolean
      dirty?: readonly RenderChannel[]
      selectionClipIds?: readonly string[]
      primaryClipId?: string | null
    },
  ) => boolean
  setCurrentFrame: (frame: number) => boolean
  setTrackScale: (scale: number, renderHints?: Partial<TimelineRenderHints>) => boolean
  setRenderHints: (hints: Partial<TimelineRenderHints>) => boolean
  setTheme: (theme: ThemeMode) => boolean
  setMagnetEnabled: (enabled: boolean) => boolean
  toggleMagnetEnabled: () => boolean
  setSelection: (clipIds: readonly string[], primaryClipId?: string | null) => boolean
  clearSelection: () => boolean
  undo: () => boolean
  redo: () => boolean
}

export interface CommandContext {
  store: TimelineStoreLike
  getPolicies: () => EditPolicies
  fitToView?: () => number | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- public default kept for API compatibility
export interface CommandSpec<TPayload = any> {
  canExecute?: (ctx: CommandContext, payload: TPayload) => boolean
  execute: (ctx: CommandContext, payload: TPayload) => boolean | void
}

export type BeforeCommandHook = (
  command: TimelineCommand,
  ctx: CommandContext,
) => boolean | TimelineCommand | void

export type AfterCommandHook = (
  command: TimelineCommand,
  executed: boolean,
  ctx: CommandContext,
) => void
