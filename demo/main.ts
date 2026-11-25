import {
  type TimelineEditor,
  cloneDocument,
  createExternalDropPlugin,
  createGridSnapProvider,
  createMarqueeSelectPlugin,
  createTimelineEditor,
  type ThemeMode,
  type TimelineDocument,
  type TimelinePlugin,
} from '../src/index'
import {
  createFancyTextSlotRenderer,
  createImageSlotRenderer,
  createShowcaseMediaProvider,
  type SlotLifecycleStats,
} from './mediaShowcase'
import { createTimelinePreviewPlayer, type TimelinePreviewPlayerHandle } from './previewPlayer'
import {
  MATERIAL_PALETTE,
  SCENARIOS,
  countDocumentClips,
  createScenarioTrackConfigs,
  type ScenarioId,
} from './scenarios'

const timelineHost = document.querySelector<HTMLDivElement>('#timeline')
const previewHost = document.querySelector<HTMLDivElement>('#preview-host')
const tabsHost = document.querySelector<HTMLDivElement>('#scenario-tabs')
const paletteHost = document.querySelector<HTMLDivElement>('#material-palette')
const scenarioDescEl = document.querySelector<HTMLSpanElement>('#scenario-desc')
const stateReadoutEl = document.querySelector<HTMLSpanElement>('#state-readout')
const btnTheme = document.querySelector<HTMLButtonElement>('#btn-theme')
const btnGridSnap = document.querySelector<HTMLButtonElement>('#btn-grid-snap')
const btnToggleToolbar = document.querySelector<HTMLButtonElement>('#btn-toggle-toolbar')
const extHistoryBar = document.querySelector<HTMLDivElement>('#external-history-bar')
const extUndoBtn = document.querySelector<HTMLButtonElement>('#ext-undo')
const extRedoBtn = document.querySelector<HTMLButtonElement>('#ext-redo')
const extSplitBtn = document.querySelector<HTMLButtonElement>('#ext-split')
const extDeleteBtn = document.querySelector<HTMLButtonElement>('#ext-delete')
const extHistoryCountEl = document.querySelector<HTMLSpanElement>('#ext-history-count')
const otioPanel = document.querySelector<HTMLDivElement>('#otio-panel')

if (!timelineHost || !previewHost || !tabsHost || !paletteHost || !scenarioDescEl || !stateReadoutEl) {
  throw new Error('Demo container elements are missing')
}

const slotStats: SlotLifecycleStats = { mounts: 0, updates: 0, destroys: 0 }
const mediaProvider = createShowcaseMediaProvider()
const fancyTextSlot = createFancyTextSlotRenderer(slotStats)
const imageSlot = createImageSlotRenderer(slotStats)
const trackConfigs = createScenarioTrackConfigs(fancyTextSlot, imageSlot)

let currentScenarioId: ScenarioId = 'full-studio'
let currentTheme: ThemeMode = 'dark'
let gridSnapEnabled = false
let toolbarVisible = true
let currentEditor: TimelineEditor | null = null
let currentPreviewPlayer: TimelinePreviewPlayerHandle | null = null
let externalPast: TimelineDocument[] = []
let externalFuture: TimelineDocument[] = []
let isApplyingExternalHistory = false
let unsubscribeReadout: (() => void) | null = null

const queryScenario = new URLSearchParams(window.location.search).get('scenario') as ScenarioId | null
if (queryScenario && queryScenario in SCENARIOS) {
  currentScenarioId = queryScenario
}

function updateExternalHistoryUI(): void {
  if (!extHistoryBar || !extUndoBtn || !extRedoBtn || !extHistoryCountEl) {
    return
  }
  const active = currentScenarioId === 'headless-external-history'
  extHistoryBar.classList.toggle('is-visible', active)
  extUndoBtn.disabled = externalPast.length === 0
  extRedoBtn.disabled = externalFuture.length === 0
  extHistoryCountEl.textContent = `Stack: ${externalPast.length} past / ${externalFuture.length} future`
  currentEditor?.setExternalHistoryState({
    canUndo: externalPast.length > 0,
    canRedo: externalFuture.length > 0,
  })
}

function updateOtioPanel(): void {
  if (!otioPanel) {
    return
  }
  const active = currentScenarioId === 'otio-roundtrip'
  otioPanel.classList.toggle('is-visible', active)
  if (active && currentEditor) {
    const otio = currentEditor.getOtioTimeline()
    otioPanel.textContent = JSON.stringify(otio, null, 2)
  }
}

function updateReadout(): void {
  if (!currentEditor || !stateReadoutEl) {
    return
  }
  const state = currentEditor.getState()
  const fps = state.document.fps || 24
  const sec = state.currentFrame / fps
  const mountedDomClips = timelineHost?.querySelectorAll('.tk-track-clip').length ?? 0
  const totalClips = countDocumentClips(state.document)

  stateReadoutEl.textContent = [
    `frame ${state.currentFrame} (${sec.toFixed(2)}s)`,
    `scale ${state.trackScale}`,
    `selected ${state.selection.clipIds.length} (${state.selection.clipId ?? 'none'})`,
    `DOM clips ${mountedDomClips}/${totalClips}`,
    `magnet ${state.isMagnetEnabled ? 'on' : 'off'}`,
    `undo ${state.canUndo ? 'yes' : 'no'} / redo ${state.canRedo ? 'yes' : 'no'}`,
    `settle v${state.renderHints.settleVersion}`,
  ].join(' · ')
}

function mountScenario(scenarioId: ScenarioId): void {
  currentScenarioId = scenarioId
  const scenario = SCENARIOS[scenarioId]

  unsubscribeReadout?.()
  unsubscribeReadout = null
  currentPreviewPlayer?.destroy()
  currentPreviewPlayer = null
  currentEditor?.destroy()
  currentEditor = null

  slotStats.mounts = 0
  slotStats.updates = 0
  slotStats.destroys = 0
  externalPast = []
  externalFuture = []
  gridSnapEnabled = scenario.enableGridSnap === true
  toolbarVisible = scenario.ui?.toolbar !== false

  const plugins: TimelinePlugin[] = [
    createExternalDropPlugin({
      resolveItem(event) {
        const raw = event.dataTransfer?.getData('application/x-timeline-kit-material')
        if (!raw) {
          return null
        }
        try {
          return JSON.parse(raw)
        }
        catch {
          return null
        }
      },
    }),
    {
      name: 'demo:grid-snap',
      snapProviders: [
        createGridSnapProvider({
          stepMs: scenario.gridStepMs ?? 500,
          enabled: () => gridSnapEnabled,
        }),
      ],
    },
  ]

  if (scenario.enableMarquee !== false) {
    plugins.push(createMarqueeSelectPlugin())
  }

  const editor = createTimelineEditor(timelineHost!, {
    document: scenario.document ? cloneDocument(scenario.document) : undefined,
    timeline: scenario.otioTimeline,
    trackScale: scenario.trackScale,
    isMagnetEnabled: scenario.isMagnetEnabled,
    trackConfigs,
    mediaProvider,
    theme: currentTheme,
    ui: scenario.ui ?? { toolbar: toolbarVisible, sidebar: true, ruler: true },
    history: scenario.history ?? 'internal',
    policies: scenario.policies,
    plugins,
    onBeforeCommand(command, ctx) {
      if (scenario.history === 'external' && !isApplyingExternalHistory) {
        const docMutating = [
          'clip:move',
          'clip:magnet-move',
          'clip:trim',
          'clip:split',
          'clip:delete',
          'clip:insert',
          'track:toggle-flag',
        ].includes(command.type)
        if (docMutating) {
          externalPast.push(cloneDocument(ctx.store.getState().document))
          externalFuture = []
        }
      }
    },
  })

  currentEditor = editor
  currentPreviewPlayer = createTimelinePreviewPlayer(previewHost!, editor, {
    enableGlobalSpaceShortcut: true,
  })
  unsubscribeReadout = editor.subscribe(() => {
    updateReadout()
    updateExternalHistoryUI()
    updateOtioPanel()
  })

  if (scenarioDescEl) {
    scenarioDescEl.textContent = `[${scenario.title}] ${scenario.description}`
  }

  Array.from(tabsHost?.children ?? []).forEach((btn) => {
    const el = btn as HTMLButtonElement
    el.classList.toggle('is-active', el.dataset.scenario === scenarioId)
  })

  syncControlButtons()
  updateExternalHistoryUI()
  updateOtioPanel()
  updateReadout()
}

function syncControlButtons(): void {
  if (btnTheme) {
    btnTheme.textContent = `Theme: ${currentTheme}`
  }
  if (btnGridSnap) {
    btnGridSnap.textContent = `Grid Snap: ${gridSnapEnabled ? 'on' : 'off'}`
    btnGridSnap.classList.toggle('is-active', gridSnapEnabled)
  }
  if (btnToggleToolbar) {
    btnToggleToolbar.textContent = `Toolbar: ${toolbarVisible ? 'on' : 'off'}`
    btnToggleToolbar.classList.toggle('is-active', toolbarVisible)
  }
}

for (const scenario of Object.values(SCENARIOS)) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'demo-tab'
  btn.dataset.scenario = scenario.id
  btn.textContent = scenario.title
  btn.addEventListener('click', () => {
    mountScenario(scenario.id)
  })
  tabsHost.appendChild(btn)
}

for (const item of MATERIAL_PALETTE) {
  const chip = document.createElement('div')
  chip.className = 'demo-material-chip'
  chip.draggable = true
  chip.dataset.materialType = item.type

  const badge = document.createElement('span')
  badge.className = 'demo-material-badge'
  badge.textContent = item.badge

  const label = document.createElement('span')
  label.textContent = item.name

  chip.append(badge, label)
  chip.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData('application/x-timeline-kit-material', JSON.stringify(item))
  })
  paletteHost.appendChild(chip)
}

btnTheme?.addEventListener('click', () => {
  const order: ThemeMode[] = ['dark', 'light', 'auto']
  currentTheme = order[(order.indexOf(currentTheme) + 1) % order.length]
  currentEditor?.setTheme(currentTheme)
  syncControlButtons()
})

btnGridSnap?.addEventListener('click', () => {
  gridSnapEnabled = !gridSnapEnabled
  syncControlButtons()
})

btnToggleToolbar?.addEventListener('click', () => {
  toolbarVisible = !toolbarVisible
  currentEditor?.setUI({ toolbar: toolbarVisible, sidebar: true, ruler: true })
  syncControlButtons()
})

extUndoBtn?.addEventListener('click', () => {
  if (!currentEditor || externalPast.length === 0) {
    return
  }
  const previous = externalPast.pop()!
  externalFuture.push(cloneDocument(currentEditor.getDocument()))
  isApplyingExternalHistory = true
  currentEditor.setDocument(previous)
  isApplyingExternalHistory = false
  updateExternalHistoryUI()
})

extRedoBtn?.addEventListener('click', () => {
  if (!currentEditor || externalFuture.length === 0) {
    return
  }
  const next = externalFuture.pop()!
  externalPast.push(cloneDocument(currentEditor.getDocument()))
  isApplyingExternalHistory = true
  currentEditor.setDocument(next)
  isApplyingExternalHistory = false
  updateExternalHistoryUI()
})

extSplitBtn?.addEventListener('click', () => {
  currentEditor?.exec('clip:split')
})

extDeleteBtn?.addEventListener('click', () => {
  currentEditor?.exec('clip:delete')
})

mountScenario(currentScenarioId)

;(window as any).__TIMELINE_DEMO__ = {
  getEditor: () => currentEditor,
  getPreviewPlayer: () => currentPreviewPlayer,
  getScenario: () => currentScenarioId,
  switchScenario: (id: ScenarioId) => mountScenario(id),
  setGridSnap: (enabled: boolean) => {
    gridSnapEnabled = enabled
    syncControlButtons()
  },
  getSlotLifecycleStats: () => ({ ...slotStats }),
  getExternalHistoryStats: () => ({
    past: externalPast.length,
    future: externalFuture.length,
  }),
  getOtioSummary: () => {
    if (!currentEditor) {
      return null
    }
    const otio = currentEditor.getOtioTimeline()
    return {
      schema: otio.OTIO_SCHEMA,
      trackCount: otio.tracks.children.length,
      tracks: otio.tracks.children.map(t => ({
        id: t.id,
        kind: t.kind,
        childrenSchemas: t.children.map(c => c.OTIO_SCHEMA),
      })),
    }
  },
}
