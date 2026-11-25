import type { Timeline as OtioTimeline } from '../otio-core'
import type { EditPolicies, TimelineDocument, TimelineSelection } from '../model/types'
import type { KeyBinding, TimelinePlugin } from '../plugins/types'
import type { ShortcutsPluginOptions } from '../plugins/shortcutsPlugin'
import type { MediaProvider, ToolbarConfig, TrackConfigMap, UIConfig } from '../renderer/types'
import type {
  BeforeCommandHook,
  HistoryMode,
  ThemeMode,
  TimelineRenderHints,
  TimelineState,
} from '../store/types'

export interface TimelineEditorOptions {
  document?: TimelineDocument
  timeline?: TimelineDocument | OtioTimeline
  fps?: number
  currentFrame?: number
  trackScale?: number
  isMagnetEnabled?: boolean
  trackConfigs?: TrackConfigMap
  toolsConfigs?: ToolbarConfig[]
  ui?: UIConfig
  theme?: ThemeMode
  injectStyles?: boolean
  policies?: Partial<EditPolicies>
  history?: HistoryMode
  onBeforeCommand?: BeforeCommandHook
  plugins?: TimelinePlugin[]
  disableDefaultPlugins?: boolean
  shortcuts?: boolean | ShortcutsPluginOptions
  keymap?: Record<string, KeyBinding | null>
  mediaProvider?: MediaProvider
  renderHints?: Partial<TimelineRenderHints>
}

export type TimelineEditorSnapshot = TimelineState
export type TimelineSelectionInput = Partial<TimelineSelection> | string | string[] | null
