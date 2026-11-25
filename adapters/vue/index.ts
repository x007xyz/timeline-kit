import {
  Teleport,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type PropType,
  type VNode,
  type Ref,
  type ShallowRef,
} from 'vue'
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
  type SlotPortalEntry,
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

export function useTimelineSelector<TSelected>(
  editorRef: Ref<VanillaTimelineEditor | null>,
  selector: (state: TimelineState) => TSelected,
): ShallowRef<TSelected | undefined> {
  const value = shallowRef<TSelected | undefined>(
    editorRef.value ? selector(editorRef.value.getState()) : undefined,
  )

  watch(
    () => editorRef.value,
    (editor: VanillaTimelineEditor | null, _: VanillaTimelineEditor | null | undefined, onCleanup: (fn: () => void) => void) => {
      if (!editor) {
        value.value = undefined
        return
      }
      value.value = selector(editor.getState())
      const unsubscribe = editor.subscribeSelector(selector, (next: TSelected) => {
        value.value = next
      })
      onCleanup(unsubscribe)
    },
    { immediate: true },
  )

  return value
}

function mergeVueTrackConfigs(
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

export const TimelineEditor = defineComponent({
  name: 'TimelineEditor',
  props: {
    document: { type: Object as PropType<TimelineDocument>, default: undefined },
    timeline: { type: Object as PropType<TimelineDocument | OtioTimeline>, default: undefined },
    fps: { type: Number, default: undefined },
    currentFrame: { type: Number, default: undefined },
    trackScale: { type: Number, default: undefined },
    isMagnetEnabled: { type: Boolean, default: undefined },
    trackConfigs: { type: Object as PropType<TrackConfigMap>, default: undefined },
    toolsConfigs: { type: Array as PropType<ToolbarConfig[]>, default: undefined },
    ui: { type: Object as PropType<UIConfig>, default: undefined },
    theme: { type: String as PropType<ThemeMode>, default: undefined },
    injectStyles: { type: Boolean, default: true },
    policies: { type: Object as PropType<Partial<EditPolicies>>, default: undefined },
    history: { type: String as PropType<HistoryMode>, default: undefined },
    plugins: { type: Array as PropType<TimelinePlugin[]>, default: undefined },
    disableDefaultPlugins: { type: Boolean, default: false },
    shortcuts: { type: Boolean, default: true },
    keymap: { type: Object as PropType<Record<string, KeyBinding | null>>, default: undefined },
    mediaProvider: { type: Object as PropType<MediaProvider>, default: undefined },
    renderHints: { type: Object as PropType<Partial<TimelineRenderHints>>, default: undefined },
    onBeforeCommand: { type: Function as unknown as PropType<BeforeCommandHook>, default: undefined },
  },
  emits: [
    'update:document',
    'update:currentFrame',
    'update:trackScale',
    'documentchange',
    'timelinechange',
    'selectionchange',
    'currentframechange',
    'trackscalechange',
    'magnetchange',
    'command',
    'ready',
  ],
  setup(props, { emit, slots, expose }) {
    const hostRef = ref<HTMLElement | null>(null)
    const editorRef = shallowRef<VanillaTimelineEditor | null>(null)
    const clipEntries = shallowRef<readonly SlotPortalEntry<ClipRenderContext>[]>([])
    const iconEntries = shallowRef<readonly SlotPortalEntry<TrackHeaderContext>[]>([])
    let lastEmittedDoc: TimelineDocument | null = null

    const clipBridge = createSlotBridge<ClipRenderContext>(ctx => ctx.clip.id)
    const iconBridge = createSlotBridge<TrackHeaderContext>(ctx => ctx.track.id)

    const unsubClip = clipBridge.subscribe(() => {
      clipEntries.value = clipBridge.getEntries()
    })
    const unsubIcon = iconBridge.subscribe(() => {
      iconEntries.value = iconBridge.getEntries()
    })

    const getEffectiveTrackConfigs = () => mergeVueTrackConfigs(
      props.trackConfigs,
      slots.clip ? clipBridge.slot : undefined,
      slots['track-icon'] ? iconBridge.slot : undefined,
    )

    onMounted(() => {
      if (!hostRef.value) {
        return
      }

      const editor = new VanillaTimelineEditor(hostRef.value, {
        document: props.document,
        timeline: props.timeline,
        fps: props.fps,
        currentFrame: props.currentFrame,
        trackScale: props.trackScale,
        isMagnetEnabled: props.isMagnetEnabled,
        trackConfigs: getEffectiveTrackConfigs(),
        toolsConfigs: props.toolsConfigs,
        ui: props.ui,
        theme: props.theme,
        injectStyles: props.injectStyles,
        policies: props.policies,
        history: props.history,
        plugins: props.plugins,
        disableDefaultPlugins: props.disableDefaultPlugins,
        shortcuts: props.shortcuts,
        keymap: props.keymap,
        mediaProvider: props.mediaProvider,
        renderHints: props.renderHints,
        onBeforeCommand: props.onBeforeCommand
          ? (cmd, ctx) => props.onBeforeCommand?.(cmd, ctx)
          : undefined,
      })

      editor.addEventListener('documentchange', (e) => {
        const snapshot = (e as CustomEvent<TimelineEditorSnapshot>).detail
        lastEmittedDoc = snapshot.document
        emit('update:document', snapshot.document)
        emit('documentchange', snapshot)
      })
      editor.addEventListener('timelinechange', (e) => {
        emit('timelinechange', (e as CustomEvent<TimelineEditorSnapshot>).detail)
      })
      editor.addEventListener('selectionchange', (e) => {
        emit('selectionchange', (e as CustomEvent<TimelineEditorSnapshot>).detail)
      })
      editor.addEventListener('currentframechange', (e) => {
        const snapshot = (e as CustomEvent<TimelineEditorSnapshot>).detail
        emit('update:currentFrame', snapshot.currentFrame)
        emit('currentframechange', snapshot)
      })
      editor.addEventListener('trackscalechange', (e) => {
        const snapshot = (e as CustomEvent<TimelineEditorSnapshot>).detail
        emit('update:trackScale', snapshot.trackScale)
        emit('trackscalechange', snapshot)
      })
      editor.addEventListener('magnetchange', (e) => {
        emit('magnetchange', (e as CustomEvent<TimelineEditorSnapshot>).detail)
      })
      editor.addEventListener('command', (e) => {
        const detail = (e as CustomEvent<{ command: TimelineCommand, snapshot: TimelineEditorSnapshot }>).detail
        emit('command', detail)
      })

      editorRef.value = editor
      emit('ready', editor)
    })

    watch(() => props.document, (nextDoc: TimelineDocument | undefined) => {
      if (!editorRef.value || !nextDoc || nextDoc === lastEmittedDoc) {
        return
      }
      editorRef.value.setDocument(nextDoc)
    })

    watch(() => props.timeline, (nextTimeline: TimelineDocument | OtioTimeline | undefined) => {
      if (!editorRef.value || !nextTimeline) {
        return
      }
      editorRef.value.setTimeline(nextTimeline)
    })

    watch(() => props.currentFrame, (nextFrame: number | undefined) => {
      if (!editorRef.value || nextFrame === undefined) {
        return
      }
      if (editorRef.value.getCurrentFrame() !== nextFrame) {
        editorRef.value.setCurrentFrame(nextFrame)
      }
    })

    watch(() => props.trackScale, (nextScale: number | undefined) => {
      if (!editorRef.value || nextScale === undefined) {
        return
      }
      if (editorRef.value.getTrackScale() !== nextScale) {
        editorRef.value.setTrackScale(nextScale, props.renderHints)
      }
    })

    watch(() => props.trackConfigs, () => {
      editorRef.value?.setTrackConfigs(getEffectiveTrackConfigs())
    }, { deep: true })

    watch(() => props.ui, (nextUi: UIConfig | undefined) => {
      if (nextUi !== undefined) {
        editorRef.value?.setUI(nextUi)
      }
    }, { deep: true })

    watch(() => props.theme, (nextTheme: ThemeMode | undefined) => {
      if (nextTheme !== undefined) {
        editorRef.value?.setTheme(nextTheme)
      }
    })

    watch(() => props.policies, (nextPolicies: Partial<EditPolicies> | undefined) => {
      if (nextPolicies !== undefined) {
        editorRef.value?.setPolicies(nextPolicies)
      }
    }, { deep: true })

    watch(() => props.mediaProvider, (nextProvider: MediaProvider | undefined) => {
      editorRef.value?.setMediaProvider(nextProvider)
    })

    watch(() => props.renderHints, (nextHints: Partial<TimelineRenderHints> | undefined) => {
      if (nextHints !== undefined) {
        editorRef.value?.setRenderHints(nextHints)
      }
    }, { deep: true })

    watch(() => props.history, (nextHistory: HistoryMode | undefined) => {
      if (nextHistory !== undefined) {
        editorRef.value?.setHistoryMode(nextHistory)
      }
    })

    onBeforeUnmount(() => {
      unsubClip()
      unsubIcon()
      editorRef.value?.destroy()
      clipBridge.clear()
      iconBridge.clear()
      editorRef.value = null
    })

    expose({
      getEditor: () => editorRef.value,
      exec: (command: string, payload?: unknown) => editorRef.value?.exec(command, payload) ?? false,
      fitToView: () => editorRef.value?.fitToView() ?? null,
      scrollToTime: (ms: number) => editorRef.value?.scrollToTime(ms),
    })

    return () => {
      const teleports: VNode[] = []
      if (slots.clip) {
        for (const entry of clipEntries.value) {
          teleports.push(
            h(
              Teleport,
              { to: entry.host, key: `clip:${entry.key}` },
              { default: () => slots.clip?.(entry.context) },
            ),
          )
        }
      }
      if (slots['track-icon']) {
        for (const entry of iconEntries.value) {
          teleports.push(
            h(
              Teleport,
              { to: entry.host, key: `icon:${entry.key}` },
              { default: () => slots['track-icon']?.(entry.context) },
            ),
          )
        }
      }

      return h(
        'div',
        { ref: hostRef, style: { width: '100%', height: '100%' } },
        teleports,
      )
    }
  },
})
