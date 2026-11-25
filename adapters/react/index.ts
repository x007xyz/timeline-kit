import {
  createElement,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type { Timeline as OtioTimeline } from '../../src/otio-core'
import {
  TimelineEditor as VanillaTimelineEditor,
  createSlotBridge,
  type BeforeCommandHook,
  type ClipRenderContext,
  type EditPolicies,
  type HistoryMode,
  type KeyBinding,
  type MediaProvider,
  type ThemeMode,
  type TimelineCommand,
  type TimelineDocument,
  type TimelineEditorSnapshot,
  type TimelinePlugin,
  type TimelineRenderHints,
  type TimelineState,
  type ToolbarConfig,
  type TrackConfigMap,
  type TrackHeaderContext,
  type UIConfig,
} from '../../src/index'

export interface TimelineEditorProps {
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
  plugins?: TimelinePlugin[]
  disableDefaultPlugins?: boolean
  shortcuts?: boolean
  keymap?: Record<string, KeyBinding | null>
  mediaProvider?: MediaProvider
  renderHints?: Partial<TimelineRenderHints>
  className?: string
  style?: CSSProperties
  renderClip?: (ctx: ClipRenderContext) => ReactNode
  renderTrackIcon?: (ctx: TrackHeaderContext) => ReactNode
  onBeforeCommand?: BeforeCommandHook
  onDocumentChange?: (snapshot: TimelineEditorSnapshot) => void
  onTimelineChange?: (snapshot: TimelineEditorSnapshot) => void
  onSelectionChange?: (snapshot: TimelineEditorSnapshot) => void
  onCurrentFrameChange?: (snapshot: TimelineEditorSnapshot) => void
  onTrackScaleChange?: (snapshot: TimelineEditorSnapshot) => void
  onMagnetChange?: (snapshot: TimelineEditorSnapshot) => void
  onCommand?: (command: TimelineCommand, snapshot: TimelineEditorSnapshot) => void
  onReady?: (editor: VanillaTimelineEditor) => void
}

export interface TimelineEditorRef {
  getEditor: () => VanillaTimelineEditor | null
  exec: (command: string, payload?: unknown) => boolean
  fitToView: () => number | null
  scrollToTime: (ms: number) => void
}

export function useTimelineSelector<TSelected>(
  editor: VanillaTimelineEditor | null | undefined,
  selector: (state: TimelineState) => TSelected,
): TSelected | undefined {
  const selectorRef = useRef(selector)
  selectorRef.current = selector

  return useSyncExternalStore(
    (onStoreChange) => {
      if (!editor) {
        return () => {}
      }
      return editor.subscribe(() => {
        onStoreChange()
      })
    },
    () => (editor ? selectorRef.current(editor.getState()) : undefined),
    () => (editor ? selectorRef.current(editor.getState()) : undefined),
  )
}

function mergeBridgeIntoTrackConfigs(
  trackConfigs: TrackConfigMap | undefined,
  clipSlot: ReturnType<typeof createSlotBridge<ClipRenderContext>>['slot'] | undefined,
  iconSlot: ReturnType<typeof createSlotBridge<TrackHeaderContext>>['slot'] | undefined,
): TrackConfigMap {
  const merged: TrackConfigMap = {}
  if (trackConfigs) {
    for (const [key, config] of Object.entries(trackConfigs)) {
      merged[key] = {
        ...config,
        clip: config.clip ?? clipSlot,
        icon: config.icon ?? iconSlot,
      }
    }
  }

  for (const type of ['video', 'audio', 'image', 'text']) {
    if (!merged[type]) {
      merged[type] = {
        type,
        clip: clipSlot,
        icon: iconSlot,
      }
    }
  }

  return merged
}

export const TimelineEditor = forwardRef<TimelineEditorRef, TimelineEditorProps>(
  function TimelineEditor(props, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null)
    const editorRef = useRef<VanillaTimelineEditor | null>(null)
    const [, setEditorInstance] = useState<VanillaTimelineEditor | null>(null)
    const propsRef = useRef(props)
    propsRef.current = props
    const lastEmittedDocRef = useRef<TimelineDocument | null>(null)

    const clipBridge = useMemo(
      () => createSlotBridge<ClipRenderContext>(ctx => ctx.clip.id),
      [],
    )
    const iconBridge = useMemo(
      () => createSlotBridge<TrackHeaderContext>(ctx => ctx.track.id),
      [],
    )

    const clipEntries = useSyncExternalStore(
      clipBridge.subscribe,
      clipBridge.getEntries,
      clipBridge.getEntries,
    )
    const iconEntries = useSyncExternalStore(
      iconBridge.subscribe,
      iconBridge.getEntries,
      iconBridge.getEntries,
    )

    const effectiveTrackConfigs = useMemo(
      () => mergeBridgeIntoTrackConfigs(
        props.trackConfigs,
        props.renderClip ? clipBridge.slot : undefined,
        props.renderTrackIcon ? iconBridge.slot : undefined,
      ),
      [props.trackConfigs, Boolean(props.renderClip), Boolean(props.renderTrackIcon), clipBridge, iconBridge],
    )

    useImperativeHandle(ref, (): TimelineEditorRef => ({
      getEditor: () => editorRef.current,
      exec: (command: string, payload?: unknown) => editorRef.current?.exec(command, payload) ?? false,
      fitToView: () => editorRef.current?.fitToView() ?? null,
      scrollToTime: (ms: number) => editorRef.current?.scrollToTime(ms),
    }))

    useEffect(() => {
      const container = hostRef.current
      if (!container) {
        return
      }

      const currentProps = propsRef.current
      const editor = new VanillaTimelineEditor(container, {
        document: currentProps.document,
        timeline: currentProps.timeline,
        fps: currentProps.fps,
        currentFrame: currentProps.currentFrame,
        trackScale: currentProps.trackScale,
        isMagnetEnabled: currentProps.isMagnetEnabled,
        trackConfigs: effectiveTrackConfigs,
        toolsConfigs: currentProps.toolsConfigs,
        ui: currentProps.ui,
        theme: currentProps.theme,
        injectStyles: currentProps.injectStyles,
        policies: currentProps.policies,
        history: currentProps.history,
        plugins: currentProps.plugins,
        disableDefaultPlugins: currentProps.disableDefaultPlugins,
        shortcuts: currentProps.shortcuts,
        keymap: currentProps.keymap,
        mediaProvider: currentProps.mediaProvider,
        renderHints: currentProps.renderHints,
        onBeforeCommand: (cmd, ctx) => propsRef.current.onBeforeCommand?.(cmd, ctx),
      })

      const onDoc = (e: Event) => {
        const snapshot = (e as CustomEvent<TimelineEditorSnapshot>).detail
        lastEmittedDocRef.current = snapshot.document
        propsRef.current.onDocumentChange?.(snapshot)
      }
      const onTimeline = (e: Event) => {
        propsRef.current.onTimelineChange?.((e as CustomEvent<TimelineEditorSnapshot>).detail)
      }
      const onSelection = (e: Event) => {
        propsRef.current.onSelectionChange?.((e as CustomEvent<TimelineEditorSnapshot>).detail)
      }
      const onFrame = (e: Event) => {
        propsRef.current.onCurrentFrameChange?.((e as CustomEvent<TimelineEditorSnapshot>).detail)
      }
      const onScale = (e: Event) => {
        propsRef.current.onTrackScaleChange?.((e as CustomEvent<TimelineEditorSnapshot>).detail)
      }
      const onMagnet = (e: Event) => {
        propsRef.current.onMagnetChange?.((e as CustomEvent<TimelineEditorSnapshot>).detail)
      }
      const onCmd = (e: Event) => {
        const detail = (e as CustomEvent<{ command: TimelineCommand, snapshot: TimelineEditorSnapshot }>).detail
        propsRef.current.onCommand?.(detail.command, detail.snapshot)
      }

      editor.addEventListener('documentchange', onDoc)
      editor.addEventListener('timelinechange', onTimeline)
      editor.addEventListener('selectionchange', onSelection)
      editor.addEventListener('currentframechange', onFrame)
      editor.addEventListener('trackscalechange', onScale)
      editor.addEventListener('magnetchange', onMagnet)
      editor.addEventListener('command', onCmd)

      editorRef.current = editor
      setEditorInstance(editor)
      currentProps.onReady?.(editor)

      return () => {
        editor.removeEventListener('documentchange', onDoc)
        editor.removeEventListener('timelinechange', onTimeline)
        editor.removeEventListener('selectionchange', onSelection)
        editor.removeEventListener('currentframechange', onFrame)
        editor.removeEventListener('trackscalechange', onScale)
        editor.removeEventListener('magnetchange', onMagnet)
        editor.removeEventListener('command', onCmd)
        editor.destroy()
        clipBridge.clear()
        iconBridge.clear()
        editorRef.current = null
        setEditorInstance(null)
      }
    }, [])

    useEffect(() => {
      const editor = editorRef.current
      if (!editor || props.document === undefined) {
        return
      }
      if (props.document === lastEmittedDocRef.current) {
        return
      }
      editor.setDocument(props.document)
    }, [props.document])

    useEffect(() => {
      const editor = editorRef.current
      if (!editor || props.timeline === undefined) {
        return
      }
      editor.setTimeline(props.timeline)
    }, [props.timeline])

    useEffect(() => {
      const editor = editorRef.current
      if (!editor || props.currentFrame === undefined) {
        return
      }
      if (editor.getCurrentFrame() !== props.currentFrame) {
        editor.setCurrentFrame(props.currentFrame)
      }
    }, [props.currentFrame])

    useEffect(() => {
      const editor = editorRef.current
      if (!editor || props.trackScale === undefined) {
        return
      }
      if (editor.getTrackScale() !== props.trackScale) {
        editor.setTrackScale(props.trackScale, props.renderHints)
      }
    }, [props.trackScale])

    useEffect(() => {
      editorRef.current?.setTrackConfigs(effectiveTrackConfigs)
    }, [effectiveTrackConfigs])

    useEffect(() => {
      if (props.ui !== undefined) {
        editorRef.current?.setUI(props.ui)
      }
    }, [props.ui])

    useEffect(() => {
      if (props.theme !== undefined) {
        editorRef.current?.setTheme(props.theme)
      }
    }, [props.theme])

    useEffect(() => {
      if (props.policies !== undefined) {
        editorRef.current?.setPolicies(props.policies)
      }
    }, [props.policies])

    useEffect(() => {
      editorRef.current?.setMediaProvider(props.mediaProvider)
    }, [props.mediaProvider])

    useEffect(() => {
      if (props.renderHints !== undefined) {
        editorRef.current?.setRenderHints(props.renderHints)
      }
    }, [props.renderHints])

    useEffect(() => {
      if (props.history !== undefined) {
        editorRef.current?.setHistoryMode(props.history)
      }
    }, [props.history])

    const portals: ReactNode[] = []
    if (props.renderClip) {
      for (const entry of clipEntries) {
        portals.push(createPortal(props.renderClip(entry.context), entry.host, `clip:${entry.key}`))
      }
    }
    if (props.renderTrackIcon) {
      for (const entry of iconEntries) {
        portals.push(createPortal(props.renderTrackIcon(entry.context), entry.host, `icon:${entry.key}`))
      }
    }

    return createElement(
      'div',
      {
        ref: hostRef,
        className: props.className,
        style: { width: '100%', height: '100%', ...(props.style ?? {}) },
      },
      ...portals,
    )
  },
)
