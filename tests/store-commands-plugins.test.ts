import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeTimelineLayout, type TimelineHitTarget } from '../src/engine'
import { createSlotBridge } from '../src/frameworks/slotBridge'
import { demoDocument } from '../src/model'
import { InteractionManager, createDefaultPlugins, matchesKeyChord } from '../src/plugins'
import type { PluginRendererPort } from '../src/plugins/types'
import { CommandBus, TimelineStore, registerBuiltinCommands, type RenderChannel } from '../src/store'

function createMockRenderer(store: TimelineStore): {
  port: PluginRendererPort
  previews: Map<string, unknown>
  overlayUpdates: unknown[]
} {
  const previews = new Map<string, unknown>()
  const overlayUpdates: unknown[] = []
  let scrollLeft = 0

  const port: PluginRendererPort = {
    getLayout: () => computeTimelineLayout(store.getState().document, { trackScale: store.getState().trackScale }),
    getViewportMetrics: () => ({
      scrollLeft,
      scrollTop: 0,
      clientWidth: 800,
      clientHeight: 400,
      trackPaddingLeft: 10,
    }),
    setScrollLeft: (px) => { scrollLeft = px },
    setOverlay: (patch) => { overlayUpdates.push(patch) },
    clearOverlay: () => { overlayUpdates.push({ cleared: true }) },
    setClipPreview: (clipId, override) => {
      if (override === null)
        previews.delete(clipId)
      else
        previews.set(clipId, override)
    },
    clearAllClipPreviews: () => { previews.clear() },
  }
  return { port, previews, overlayUpdates }
}

describe('store, commands, plugins, and slotBridge', () => {
  it('maintains stable state references, fires selector listeners only on change, and tracks dirty channels precisely', () => {
    const store = new TimelineStore({ document: demoDocument })
    const initialRef = store.getState()
    assert.equal(store.getState(), initialRef)

    const dirtyLogs: Array<Set<RenderChannel>> = []
    store.subscribe(({ dirty }) => {
      dirtyLogs.push(new Set(dirty))
    })

    let selectionCount = 0
    let frameCount = 0
    store.subscribeSelector(s => s.selection.clipId, () => { selectionCount += 1 })
    store.subscribeSelector(s => s.currentFrame, () => { frameCount += 1 })

    store.setCurrentFrame(24)
    assert.notEqual(store.getState(), initialRef)
    assert.equal(frameCount, 1)
    assert.equal(selectionCount, 0)
    assert.deepEqual(Array.from(dirtyLogs[0]), ['playhead'])

    store.setSelection(['clip-v1-open'], 'clip-v1-open')
    assert.equal(selectionCount, 1)
    assert.equal(frameCount, 1)
    assert.deepEqual(Array.from(dirtyLogs[1]).sort(), ['selection', 'toolbar'])
  })

  it('supports internal undo/redo, external history mode, and CommandBus beforeHook veto/rewrite', () => {
    const store = new TimelineStore({ document: demoDocument, historyMode: 'internal' })
    const bus = new CommandBus({
      store,
      getPolicies: () => ({
        allowOverlap: false,
        allowCrossTrackType: false,
        removeEmptyTracks: true,
        orderAudioToBottom: true,
      }),
    })
    registerBuiltinCommands(bus)

    bus.execute('selection:set', { clipId: 'clip-v1-open' })
    assert.equal(bus.execute('delete'), true)
    assert.equal(store.getState().canUndo, true)
    assert.equal(store.getState().document.tracks.some(t => t.id === 'track-v1'), false) // empty track removed!

    assert.equal(bus.execute('undo'), true)
    assert.equal(store.getState().canRedo, true)
    assert.equal(store.getState().document.tracks.some(t => t.id === 'track-v1'), true)

    // Veto hook
    const unsubVeto = bus.addBeforeHook(cmd => (cmd.type === 'clip:delete' ? false : undefined))
    bus.execute('selection:set', { clipId: 'clip-v1-open' })
    assert.equal(bus.execute('clip:delete'), false)
    unsubVeto()

    // External history mode suppresses internal stack
    store.setHistoryMode('external')
    assert.equal(bus.execute('clip:delete'), true)
    assert.equal(store.getState().canUndo, false)
    store.setExternalHistoryState({ canUndo: true, canRedo: false })
    assert.equal(store.getState().canUndo, true)
  })

  it('routes interactions by priority, cancels mid-drag on Escape, and matches key chords', () => {
    const store = new TimelineStore({ document: demoDocument })
    const bus = new CommandBus({
      store,
      getPolicies: () => ({
        allowOverlap: false,
        allowCrossTrackType: false,
        removeEmptyTracks: true,
        orderAudioToBottom: true,
      }),
    })
    registerBuiltinCommands(bus)
    const mock = createMockRenderer(store)
    const interactions = new InteractionManager({
      store,
      commands: bus,
      renderer: mock.port,
      getPolicies: () => ({
        allowOverlap: false,
        allowCrossTrackType: false,
        removeEmptyTracks: true,
        orderAudioToBottom: true,
      }),
    })
    for (const plugin of createDefaultPlugins()) {
      interactions.use(plugin)
    }

    const layout = mock.port.getLayout()
    const videoClip = layout.tracks[1].clips[0]
    const videoY = (layout.tracks[1].startY + layout.tracks[1].endY) / 2
    const hitBody: TimelineHitTarget = {
      zone: 'clip-body',
      timeMs: 1000,
      frame: 24,
      x: videoClip.leftPx + 20,
      y: videoY,
      trackIndex: 1,
      clipIndex: 0,
      clipId: videoClip.clip.id,
    }

    const claimed = interactions.handlePointerDown({
      originalEvent: { preventDefault() {} } as PointerEvent,
      hit: hitBody,
      clientX: 100,
      clientY: 200,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      button: 0,
    })
    assert.equal(claimed, true)
    assert.equal(interactions.hasActiveSession(), true)

    // Move past 3px deadzone -> sets preview
    interactions.handlePointerMove({
      originalEvent: { preventDefault() {} } as PointerEvent,
      hit: { ...hitBody, x: videoClip.leftPx + 60 },
      clientX: 140,
      clientY: 200,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      button: 0,
    })
    assert.equal(mock.previews.has(videoClip.clip.id), true)

    // Cancel via Escape -> clears previews and keeps original clip position
    const handledEsc = interactions.handleKeyDown({
      key: 'Escape',
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      target: null,
      preventDefault() {},
    } as unknown as KeyboardEvent)
    assert.equal(handledEsc, true)
    assert.equal(interactions.hasActiveSession(), false)
    assert.equal(mock.previews.size, 0)
    assert.equal(store.getState().document.tracks[1].clips[0].startMs, 0)

    // Chord matching
    assert.equal(matchesKeyChord({ key: 'z', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false } as KeyboardEvent, 'Mod+Z'), true)
    assert.equal(matchesKeyChord({ key: 'z', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false } as KeyboardEvent, 'Mod+Z'), false)
    assert.equal(matchesKeyChord({ key: 'z', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false } as KeyboardEvent, 'Mod+Shift+Z'), true)
  })

  it('manages SlotBridge mount/update/destroy lifecycle with stable snapshot refs and host safety', () => {
    const bridge = createSlotBridge<{ id: string, label: string }>(ctx => ctx.id)
    const snap0 = bridge.getEntries()
    assert.equal(bridge.getEntries(), snap0)

    let changes = 0
    bridge.subscribe(() => { changes += 1 })

    const hostA = {} as HTMLElement
    const hostB = {} as HTMLElement
    const handleA = bridge.slot.mount(hostA, { id: 'c1', label: 'A' })!
    assert.equal(changes, 1)
    assert.equal(bridge.getEntries().length, 1)
    assert.equal(bridge.getEntries()[0].context.label, 'A')

    handleA.update?.({ id: 'c1', label: 'A2' })
    assert.equal(bridge.getEntries()[0].context.label, 'A2')

    // Re-mounting same key onto new hostB must not be deleted by stale hostA destroy!
    const handleB = bridge.slot.mount(hostB, { id: 'c1', label: 'B' })!
    handleA.destroy?.()
    assert.equal(bridge.getEntries().length, 1)
    assert.equal(bridge.getEntries()[0].host, hostB)

    handleB.destroy?.()
    assert.equal(bridge.getEntries().length, 0)
  })
})
