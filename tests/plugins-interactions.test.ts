import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  computeTimelineLayout,
  type TimelineHitTarget,
  type TimelineLayoutSnapshot,
} from '../src/engine'
import type { EditPolicies, TimelineDocument } from '../src/model'
import {
  clipEdgeSnapProvider,
  createClipDragPlugin,
  createClipTrimPlugin,
  createDefaultPlugins,
  createExternalDropPlugin,
  createGridSnapProvider,
  createMarqueeSelectPlugin,
  createShortcutsPlugin,
  createSelectionPlugin,
  InteractionManager,
  playheadSnapProvider,
  type ClipPreviewOverride,
  type ExternalDropItem,
  type OverlayState,
  type PluginRendererPort,
  type TimelineDropEvent,
  type TimelinePointerEvent,
  type TimelineWheelEvent,
} from '../src/plugins'
import { CommandBus, registerBuiltinCommands, TimelineStore } from '../src/store'

const POLICIES: EditPolicies = {
  allowOverlap: false,
  allowCrossTrackType: false,
  removeEmptyTracks: true,
  orderAudioToBottom: true,
}

/**
 * Fixture (fps 24, default scale 50 -> 40 px per second):
 *   t0 video  [a 0-2000ms, b 3000-3500ms]          y 20..84
 *   t1 audio  [m 0-4000ms]                          y 88..152
 *   t2 video  locked [L 0-1000ms]                   y 156..220
 */
function fixtureDoc(mainTrack0 = false): TimelineDocument {
  return {
    id: 'interaction-doc',
    name: 'Interaction',
    fps: 24,
    tracks: [
      {
        id: 't0',
        type: 'video',
        name: 'V1',
        main: mainTrack0,
        clips: [
          { id: 'a', type: 'video', name: 'A', resource: 'a.mov', startMs: 0, endMs: 2000, durationMs: 2000 },
          { id: 'b', type: 'video', name: 'B', resource: 'b.mov', startMs: 3000, endMs: 3500 },
        ],
      },
      {
        id: 't1',
        type: 'audio',
        name: 'A1',
        clips: [{ id: 'm', type: 'audio', name: 'M', resource: 'm.wav', startMs: 0, endMs: 4000 }],
      },
      {
        id: 't2',
        type: 'video',
        name: 'V2',
        locked: true,
        clips: [{ id: 'L', type: 'video', name: 'L', startMs: 0, endMs: 1000 }],
      },
    ],
  }
}

interface MockRenderer {
  port: PluginRendererPort
  previews: Map<string, ClipPreviewOverride>
  getOverlay: () => Partial<OverlayState>
  getScrollLeft: () => number
  clearOverlayCount: () => number
}

function createMockRenderer(store: TimelineStore): MockRenderer {
  const previews = new Map<string, ClipPreviewOverride>()
  let overlay: Partial<OverlayState> = {}
  let scrollLeft = 0
  let clearOverlayCount = 0

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
    setOverlay: (patch) => { overlay = { ...overlay, ...patch } },
    clearOverlay: () => {
      clearOverlayCount += 1
      overlay = {}
    },
    setClipPreview: (clipId, override) => {
      if (override === null) {
        previews.delete(clipId)
      }
      else {
        previews.set(clipId, override)
      }
    },
    clearAllClipPreviews: () => { previews.clear() },
  }

  return {
    port,
    previews,
    getOverlay: () => overlay,
    getScrollLeft: () => scrollLeft,
    clearOverlayCount: () => clearOverlayCount,
  }
}

interface Harness {
  store: TimelineStore
  bus: CommandBus
  interactions: InteractionManager
  mock: MockRenderer
  layout: () => TimelineLayoutSnapshot
  externalItem: { current: ExternalDropItem | null }
}

function createHarness(
  doc: TimelineDocument,
  options: { magnet?: boolean, shortcuts?: boolean | { enabled?: boolean, keymap?: Record<string, string | null> } } = {},
): Harness {
  const store = new TimelineStore({ document: doc, isMagnetEnabled: options.magnet ?? false })
  const bus = new CommandBus({ store, getPolicies: () => POLICIES })
  registerBuiltinCommands(bus)
  const mock = createMockRenderer(store)
  const interactions = new InteractionManager({
    store,
    commands: bus,
    renderer: mock.port,
    getPolicies: () => POLICIES,
  })
  for (const plugin of createDefaultPlugins({ shortcuts: options.shortcuts ?? true })) {
    interactions.use(plugin)
  }
  interactions.use(createMarqueeSelectPlugin())
  const externalItem: { current: ExternalDropItem | null } = { current: null }
  interactions.use(createExternalDropPlugin({ resolveItem: () => externalItem.current }))

  return {
    store,
    bus,
    interactions,
    mock,
    layout: () => mock.port.getLayout(),
    externalItem,
  }
}

function fakePointer(): PointerEvent {
  return { preventDefault() {} } as unknown as PointerEvent
}

function fakeHit(partial: Partial<TimelineHitTarget> & { zone: TimelineHitTarget['zone'] }): TimelineHitTarget {
  return {
    timeMs: 0,
    frame: 0,
    x: 0,
    y: 0,
    trackIndex: -1,
    clipIndex: -1,
    clipId: null,
    ...partial,
  } as TimelineHitTarget
}

function pointer(hit: TimelineHitTarget, clientX: number, clientY: number, extra: Partial<TimelinePointerEvent> = {}): TimelinePointerEvent {
  return {
    originalEvent: fakePointer(),
    hit,
    clientX,
    clientY,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    button: 0,
    ...extra,
  }
}

function keyEvent(key: string, extra: Record<string, unknown> = {}): KeyboardEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: null,
    preventDefault() {},
    ...extra,
  } as unknown as KeyboardEvent
}

function midY(layout: TimelineLayoutSnapshot, trackIndex: number): number {
  const track = layout.tracks[trackIndex]
  return (track.startY + track.endY) / 2
}

/** Hit target for a clip in the current layout; offsetX is relative to the clip's left edge. */
function clipHit(
  layout: TimelineLayoutSnapshot,
  trackIndex: number,
  clipIndex: number,
  zone: 'clip-body' | 'trim-start' | 'trim-end' = 'clip-body',
  offsetX = 20,
): TimelineHitTarget {
  const lc = layout.tracks[trackIndex].clips[clipIndex]
  const x = zone === 'trim-start'
    ? lc.leftPx
    : zone === 'trim-end'
      ? lc.leftPx + lc.widthPx
      : lc.leftPx + offsetX
  return fakeHit({
    zone,
    timeMs: lc.startMs + 500,
    frame: 12,
    x,
    y: midY(layout, trackIndex),
    trackIndex,
    clipIndex,
    clipId: lc.clip.id,
  })
}

function trackClipIds(store: TimelineStore, trackIndex: number): string[] {
  return store.getState().document.tracks[trackIndex].clips.map(c => c.id)
}

describe('plugins driven through InteractionManager', () => {
  describe('clip drag', () => {
    it('moves a clip on release after the pointer passes the dead zone and selects it', () => {
      const h = createHarness(fixtureDoc())
      const layout = h.layout()
      const down = clipHit(layout, 0, 0)

      assert.equal(h.interactions.handlePointerDown(pointer(down, 100, 52)), true)
      assert.equal(h.interactions.hasActiveSession(), true)
      assert.equal(h.store.getState().selection.clipId, 'a')

      h.interactions.handlePointerMove(pointer({ ...down, x: 340, y: 52 }, 400, 52))
      assert.deepEqual(h.mock.previews.get('a'), { leftPx: 300, translateY: 0, isDragging: true })
      assert.equal(h.mock.getOverlay().dragPreview?.topPx, 20)

      h.interactions.handlePointerUp(pointer({ ...down, x: 340, y: 52 }, 400, 52))
      assert.equal(h.interactions.hasActiveSession(), false)
      assert.equal(h.mock.previews.size, 0)
      assert.deepEqual(h.mock.getOverlay(), {})

      const moved = h.store.getState().document.tracks[0].clips.find(c => c.id === 'a')!
      assert.equal(moved.startMs, 7500)
      assert.equal(moved.endMs, 9500)
      assert.deepEqual(trackClipIds(h.store, 0), ['b', 'a'])
      assert.equal(h.store.getState().selection.clipId, 'a')
    })

    it('treats movement under 3px as a click: no preview and no document change on release', () => {
      const h = createHarness(fixtureDoc())
      const down = clipHit(h.layout(), 0, 0)
      const before = h.store.getState().document

      h.interactions.handlePointerDown(pointer(down, 100, 52))
      h.interactions.handlePointerMove(pointer(down, 101, 53))
      assert.equal(h.mock.previews.size, 0)
      h.interactions.handlePointerUp(pointer(down, 101, 53))

      assert.equal(h.store.getState().document, before)
      assert.equal(h.store.getState().canUndo, false)
    })

    it('a drag released at its original position still pushes an undo step [regression]', () => {
      const h = createHarness(fixtureDoc())
      const down = clipHit(h.layout(), 0, 0)

      h.interactions.handlePointerDown(pointer(down, 100, 52))
      h.interactions.handlePointerMove(pointer({ ...down, x: 60, y: 52 }, 120, 52))
      h.interactions.handlePointerMove(pointer(down, 100, 52))
      h.interactions.handlePointerUp(pointer(down, 100, 52))

      assert.equal(h.store.getState().canUndo, false)
    })

    it('snaps the dragged start to a neighbouring clip edge within 10px and reports the guideline', () => {
      const h = createHarness(fixtureDoc())
      const down = clipHit(h.layout(), 0, 0)

      h.interactions.handlePointerDown(pointer(down, 100, 52))
      // Pointer to x=242 -> left 142px; b's end edge is at 140px (3500ms), within the 10px threshold
      h.interactions.handlePointerMove(pointer({ ...down, x: 362, y: 52 }, 242, 52))
      assert.equal(h.mock.getOverlay().verticalGuidelinePx, 140)
      assert.equal(h.mock.previews.get('a')?.leftPx, 140)

      h.interactions.handlePointerUp(pointer({ ...down, x: 362, y: 52 }, 242, 52))
      const moved = h.store.getState().document.tracks[0].clips.find(c => c.id === 'a')!
      assert.equal(moved.startMs, 3500)
      assert.equal(moved.endMs, 5500)
    })

    it('creates a new track instead of overlapping a clip when the released span collides', () => {
      const h = createHarness(fixtureDoc())
      const down = clipHit(h.layout(), 0, 0)

      h.interactions.handlePointerDown(pointer(down, 100, 52))
      // left 130px (3250ms) overlaps b (3000-3500ms); y 52 is the top half boundary of t0
      h.interactions.handlePointerMove(pointer({ ...down, x: 350, y: 52 }, 230, 52))
      h.interactions.handlePointerUp(pointer({ ...down, x: 350, y: 52 }, 230, 52))

      const tracks = h.store.getState().document.tracks
      assert.equal(tracks.length, 4)
      assert.deepEqual(trackClipIds(h.store, 0), ['b'])
      assert.equal(tracks[1].type, 'video')
      assert.deepEqual(tracks[1].clips.map(c => [c.id, c.startMs]), [['a', 3250]])
    })

    it('cross-type drag of an audio clip onto a video track creates a new audio track at that position', () => {
      const h = createHarness(fixtureDoc())
      const down = clipHit(h.layout(), 1, 0)

      h.interactions.handlePointerDown(pointer(down, 40, 120))
      h.interactions.handlePointerMove(pointer({ ...down, x: 340, y: 40 }, 340, 40))
      h.interactions.handlePointerUp(pointer({ ...down, x: 340, y: 40 }, 340, 40))

      // The emptied audio track is removed by cleanup; the new audio track is sorted to the bottom.
      const tracks = h.store.getState().document.tracks
      assert.equal(tracks.length, 3)
      assert.deepEqual(trackClipIds(h.store, 0), ['a', 'b'])
      const audio = tracks.find(t => t.type === 'audio')!
      assert.deepEqual(audio.clips.map(c => [c.id, c.startMs]), [['m', 7500]])
      assert.equal(tracks[tracks.length - 1], audio)
    })

    it('dropping onto a locked track creates a new track beside it and leaves the locked track untouched', () => {
      const h = createHarness(fixtureDoc())
      const down = clipHit(h.layout(), 0, 0)

      h.interactions.handlePointerDown(pointer(down, 100, 52))
      h.interactions.handlePointerMove(pointer({ ...down, x: 340, y: 190 }, 400, 190))
      h.interactions.handlePointerUp(pointer({ ...down, x: 340, y: 190 }, 400, 190))

      // Order after cleanup and audio-to-bottom sorting: [t0, locked L, new track with a, audio m]
      const tracks = h.store.getState().document.tracks
      assert.equal(tracks.length, 4)
      assert.deepEqual(trackClipIds(h.store, 1), ['L'])
      assert.equal(tracks[1].locked, true)
      assert.deepEqual(trackClipIds(h.store, 2), ['a'])
      assert.equal(tracks[2].clips[0].startMs, 7500)
    })

    it('Escape cancels an in-flight drag, clears the preview and leaves the document untouched', () => {
      const h = createHarness(fixtureDoc())
      const before = h.store.getState().document
      const down = clipHit(h.layout(), 0, 0)

      h.interactions.handlePointerDown(pointer(down, 100, 52))
      h.interactions.handlePointerMove(pointer({ ...down, x: 340, y: 52 }, 400, 52))
      assert.equal(h.mock.previews.has('a'), true)

      assert.equal(h.interactions.handleKeyDown(keyEvent('Escape')), true)
      assert.equal(h.interactions.hasActiveSession(), false)
      assert.equal(h.mock.previews.size, 0)
      assert.equal(h.store.getState().document, before)
      assert.equal(h.store.getState().canUndo, false)
    })

    it('a magnet main track packs the dragged clip into the arrangement on release', () => {
      const h = createHarness(fixtureDoc(true), { magnet: true })
      const down = clipHit(h.layout(), 0, 0)

      h.interactions.handlePointerDown(pointer(down, 100, 52))
      // Cursor at 320px is past b (120..140px) so the clip is inserted after b
      h.interactions.handlePointerMove(pointer({ ...down, x: 320, y: 52 }, 400, 52))
      h.interactions.handlePointerUp(pointer({ ...down, x: 320, y: 52 }, 400, 52))

      const clips = h.store.getState().document.tracks[0].clips
      assert.deepEqual(clips.map(c => [c.id, c.startMs, c.endMs]), [
        ['b', 0, 500],
        ['a', 500, 2500],
      ])
    })

    it('refuses to drag a clip from a locked track and clears the selection', () => {
      const h = createHarness(fixtureDoc())
      h.bus.execute('selection:set', { clipId: 'a' })

      const lockedDown = clipHit(h.layout(), 2, 0)
      assert.equal(h.interactions.handlePointerDown(pointer(lockedDown, 40, 180)), false)
      assert.equal(h.interactions.hasActiveSession(), false)
      assert.equal(h.store.getState().selection.clipId, null)
      assert.deepEqual(trackClipIds(h.store, 2), ['L'])
    })
  })

  describe('clip trim', () => {
    it('shrinks a clip from the end edge and records the trim range', () => {
      const h = createHarness(fixtureDoc())
      const down = clipHit(h.layout(), 0, 0, 'trim-end')

      h.interactions.handlePointerDown(pointer(down, 80, 52))
      assert.equal(h.mock.previews.get('a')?.isTrimming, true)
      h.interactions.handlePointerMove(pointer(down, 60, 52))
      assert.equal(h.mock.previews.get('a')?.widthPx, 60)
      h.interactions.handlePointerUp(pointer(down, 60, 52))

      const clip = h.store.getState().document.tracks[0].clips.find(c => c.id === 'a')!
      assert.equal(clip.endMs, 1500)
      assert.deepEqual(clip.trim, { startMs: 0, endMs: 1500 })
      assert.equal(h.mock.previews.size, 0)
    })

    it('moves the start edge to the right and shifts trim.startMs by the same amount', () => {
      const h = createHarness(fixtureDoc())
      const down = clipHit(h.layout(), 0, 0, 'trim-start')

      h.interactions.handlePointerDown(pointer(down, 100, 52))
      h.interactions.handlePointerMove(pointer(down, 140, 52))
      h.interactions.handlePointerUp(pointer(down, 140, 52))

      const clip = h.store.getState().document.tracks[0].clips.find(c => c.id === 'a')!
      assert.equal(clip.startMs, 1000)
      assert.equal(clip.endMs, 2000)
      assert.deepEqual(clip.trim, { startMs: 1000, endMs: 2000 })
    })

    it('extending a media clip past its source length is clamped to no change and no command', () => {
      const h = createHarness(fixtureDoc())
      const before = h.store.getState().document
      const down = clipHit(h.layout(), 0, 0, 'trim-end')

      h.interactions.handlePointerDown(pointer(down, 80, 52))
      h.interactions.handlePointerMove(pointer(down, 280, 52))
      h.interactions.handlePointerUp(pointer(down, 280, 52))

      assert.equal(h.store.getState().document, before)
      assert.equal(h.store.getState().canUndo, false)
    })

    it('refuses trim handles on a locked track', () => {
      const h = createHarness(fixtureDoc())
      const lockedEdge = clipHit(h.layout(), 2, 0, 'trim-end')
      assert.equal(h.interactions.handlePointerDown(pointer(lockedEdge, 40, 180)), false)
      assert.equal(h.interactions.hasActiveSession(), false)
    })

    it('Escape cancels an in-flight trim without touching the document', () => {
      const h = createHarness(fixtureDoc())
      const before = h.store.getState().document
      const down = clipHit(h.layout(), 0, 0, 'trim-end')

      h.interactions.handlePointerDown(pointer(down, 80, 52))
      h.interactions.handlePointerMove(pointer(down, 40, 52))
      h.interactions.handleKeyDown(keyEvent('Escape'))

      assert.equal(h.mock.previews.size, 0)
      assert.equal(h.store.getState().document, before)
    })
  })

  describe('selection', () => {
    it('a plain click selects exactly one clip', () => {
      const h = createHarness(fixtureDoc())
      const b = clipHit(h.layout(), 0, 1)
      h.interactions.handlePointerDown(pointer(b, 130, 52))
      h.interactions.handlePointerUp(pointer(b, 130, 52))
      const selection = h.store.getState().selection
      assert.deepEqual(selection.clipIds, ['b'])
      assert.equal(selection.clipId, 'b')
    })

    it('ctrl-click toggles clips in and out of the multi-selection', () => {
      const h = createHarness(fixtureDoc())
      const layout = h.layout()
      h.interactions.handlePointerDown(pointer(clipHit(layout, 0, 0), 60, 52))
      h.interactions.handlePointerUp(pointer(clipHit(layout, 0, 0), 60, 52))

      const ctrlB = pointer(clipHit(layout, 0, 1), 130, 52, { ctrlKey: true })
      assert.equal(h.interactions.handlePointerDown(ctrlB), true)
      h.interactions.handlePointerUp(ctrlB)
      assert.deepEqual(h.store.getState().selection.clipIds, ['a', 'b'])
      assert.equal(h.store.getState().selection.clipId, 'b')

      const ctrlA = pointer(clipHit(layout, 0, 0), 60, 52, { ctrlKey: true })
      h.interactions.handlePointerDown(ctrlA)
      h.interactions.handlePointerUp(ctrlA)
      assert.deepEqual(h.store.getState().selection.clipIds, ['b'])
      assert.equal(h.store.getState().selection.clipId, 'b')
    })

    it('a click on empty track space moves the playhead to the hit frame and clears the selection', () => {
      const h = createHarness(fixtureDoc())
      h.bus.execute('selection:set', { clipId: 'a' })
      const empty = fakeHit({ zone: 'track-empty', frame: 24, x: 500, y: 52, trackIndex: 0 })

      assert.equal(h.interactions.handlePointerDown(pointer(empty, 500, 52)), true)
      h.interactions.handlePointerUp(pointer(empty, 500, 52))

      assert.equal(h.store.getState().currentFrame, 24)
      assert.equal(h.store.getState().selection.clipId, null)
      assert.deepEqual(h.store.getState().selection.clipIds, [])
    })

    it('toolbar hits are not claimed by any interaction', () => {
      const h = createHarness(fixtureDoc())
      h.bus.execute('selection:set', { clipId: 'a' })
      const toolbar = fakeHit({ zone: 'toolbar' })
      assert.equal(h.interactions.handlePointerDown(pointer(toolbar, 0, 0)), false)
      assert.equal(h.store.getState().selection.clipId, 'a')
    })
  })

  describe('marquee select', () => {
    it('selects every intersecting unlocked clip and publishes the rectangle while dragging', () => {
      const h = createHarness(fixtureDoc())
      const start = fakeHit({ zone: 'track-empty', x: 0, y: 30, trackIndex: 0, frame: 0 })

      assert.equal(h.interactions.handlePointerDown(pointer(start, 0, 30)), true)
      h.interactions.handlePointerMove(pointer({ ...start, x: 300, y: 200 }, 300, 200))

      assert.deepEqual(h.mock.getOverlay().marqueeRect, { leftPx: 0, topPx: 30, widthPx: 300, heightPx: 170 })
      assert.deepEqual(h.store.getState().selection.clipIds, ['a', 'b', 'm'])
      assert.equal(h.store.getState().selection.clipId, 'a')

      h.interactions.handlePointerUp(pointer({ ...start, x: 300, y: 200 }, 300, 200))
      assert.equal(h.mock.getOverlay().marqueeRect, null)
    })

    it('a movement under 4px is a click that moves the playhead rather than starting a marquee', () => {
      const h = createHarness(fixtureDoc())
      const start = fakeHit({ zone: 'track-empty', x: 0, y: 30, trackIndex: 0, frame: 48 })
      h.interactions.handlePointerDown(pointer(start, 0, 30))
      h.interactions.handlePointerMove(pointer({ ...start, x: 2, y: 31 }, 2, 31))
      assert.equal(h.mock.getOverlay().marqueeRect, undefined)
      h.interactions.handlePointerUp(pointer(start, 2, 31))
      assert.equal(h.store.getState().currentFrame, 48)
    })

    it('Escape removes the marquee overlay', () => {
      const h = createHarness(fixtureDoc())
      const start = fakeHit({ zone: 'track-empty', x: 0, y: 30, trackIndex: 0 })
      h.interactions.handlePointerDown(pointer(start, 0, 30))
      h.interactions.handlePointerMove(pointer({ ...start, x: 100, y: 100 }, 100, 100))
      assert.notEqual(h.mock.getOverlay().marqueeRect, null)
      h.interactions.handleKeyDown(keyEvent('Escape'))
      assert.equal(h.mock.getOverlay().marqueeRect, null)
    })
  })

  describe('wheel navigation', () => {
    it('ignores a plain wheel event over the timeline', () => {
      const h = createHarness(fixtureDoc())
      const event: TimelineWheelEvent = {
        originalEvent: { preventDefault() {} } as unknown as WheelEvent,
        hit: fakeHit({ zone: 'track-empty', x: 40, y: 52 }),
        deltaX: 0,
        deltaY: 50,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }
      assert.equal(h.interactions.handleWheel(event), false)
      assert.equal(h.store.getState().trackScale, 50)
    })

    it('ctrl+wheel zooms around the pointer and keeps the anchor time under the cursor', () => {
      const h = createHarness(fixtureDoc())
      const event: TimelineWheelEvent = {
        originalEvent: { preventDefault() {} } as unknown as WheelEvent,
        hit: fakeHit({ zone: 'clip-body', x: 40, y: 52, timeMs: 1000 }),
        deltaX: 0,
        deltaY: -100,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }
      assert.equal(h.interactions.handleWheel(event), true)
      assert.equal(h.store.getState().trackScale, 58)
      assert.equal(h.store.getState().renderHints.zoomActive, true)
      // pps at scale 58 with 24 fps is 72; 1000ms -> 72px; scrollLeft = 72 + 10 - (40 + 10)
      assert.equal(h.mock.getScrollLeft(), 32)
      h.interactions.remove('builtin:wheel') // clears the 160ms settle timer
    })

    it('ctrl+wheel at the maximum scale is consumed without changing scale or scroll', () => {
      const h = createHarness(fixtureDoc())
      h.bus.execute('scale:set', { scale: 100 })
      const event: TimelineWheelEvent = {
        originalEvent: { preventDefault() {} } as unknown as WheelEvent,
        hit: fakeHit({ zone: 'clip-body', x: 40, y: 52, timeMs: 1000 }),
        deltaX: 0,
        deltaY: -100,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }
      assert.equal(h.interactions.handleWheel(event), true)
      assert.equal(h.store.getState().trackScale, 100)
      assert.equal(h.mock.getScrollLeft(), 0)
      h.interactions.remove('builtin:wheel')
    })

    it('ctrl+wheel over the toolbar is not handled', () => {
      const h = createHarness(fixtureDoc())
      const event: TimelineWheelEvent = {
        originalEvent: { preventDefault() {} } as unknown as WheelEvent,
        hit: fakeHit({ zone: 'toolbar' }),
        deltaX: 0,
        deltaY: -100,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }
      assert.equal(h.interactions.handleWheel(event), false)
      assert.equal(h.store.getState().trackScale, 50)
    })

    it('shift+vertical wheel scrolls horizontally, clamped at zero, while horizontal-dominant wheel is left alone', () => {
      const h = createHarness(fixtureDoc())
      const shiftDown = (deltaY: number, deltaX: number): TimelineWheelEvent => ({
        originalEvent: { preventDefault() {} } as unknown as WheelEvent,
        hit: fakeHit({ zone: 'track-empty', x: 40, y: 52 }),
        deltaX,
        deltaY,
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
      })

      assert.equal(h.interactions.handleWheel(shiftDown(120, 0)), true)
      assert.equal(h.mock.getScrollLeft(), 120)

      assert.equal(h.interactions.handleWheel(shiftDown(-500, 0)), true)
      assert.equal(h.mock.getScrollLeft(), 0)

      assert.equal(h.interactions.handleWheel(shiftDown(10, 200)), false)
      assert.equal(h.mock.getScrollLeft(), 0)
    })
  })

  describe('external drop', () => {
    function dragOver(h: Harness, hit: TimelineHitTarget): boolean {
      const event: TimelineDropEvent = {
        originalEvent: { preventDefault() {} } as unknown as DragEvent,
        hit,
        dataTransfer: null,
      }
      return h.interactions.handleDragOver(event)
    }

    function dropEvent(hit: TimelineHitTarget): TimelineDropEvent {
      return {
        originalEvent: { preventDefault() {} } as unknown as DragEvent,
        hit,
        dataTransfer: null,
      }
    }

    it('shows a drag preview for a video item over a free span of the hovered track', () => {
      const h = createHarness(fixtureDoc())
      h.externalItem.current = { type: 'video', name: 'Intro', durationMs: 1000 }
      const hover = fakeHit({ zone: 'track-empty', x: 200, y: 52, trackIndex: 0 })

      assert.equal(dragOver(h, hover), true)
      assert.deepEqual(h.mock.getOverlay().dragPreview, {
        leftPx: 200,
        topPx: 20,
        widthPx: 40,
        heightPx: 64,
        label: 'Intro',
      })
      assert.equal(h.mock.getOverlay().horizontalGuidelinePx, null)
    })

    it('shows a new-track guide for an audio item hovering a video track', () => {
      const h = createHarness(fixtureDoc())
      h.externalItem.current = { type: 'audio', name: 'Music', durationMs: 1000 }
      const hover = fakeHit({ zone: 'track-empty', x: 200, y: 40, trackIndex: 0 })

      assert.equal(dragOver(h, hover), true)
      assert.equal(h.mock.getOverlay().dragPreview, null)
      assert.equal(h.mock.getOverlay().horizontalGuidelinePx, 17)
    })

    it('does not claim a drag whose payload the host does not recognise', () => {
      const h = createHarness(fixtureDoc())
      h.externalItem.current = null
      assert.equal(dragOver(h, fakeHit({ zone: 'track-empty', x: 200, y: 52, trackIndex: 0 })), false)
      assert.equal(h.interactions.handleDrop(dropEvent(fakeHit({ zone: 'track-empty', x: 200, y: 52 }))), false)
    })

    it('drop inserts the item at the hovered time with the given id and resource', () => {
      const h = createHarness(fixtureDoc())
      h.externalItem.current = { id: 'new-1', type: 'video', name: 'New', durationMs: 1000, resource: 'new.mov' }

      const handled = h.interactions.handleDrop(dropEvent(fakeHit({ zone: 'track-empty', x: 200, y: 52, trackIndex: 0 })))
      assert.equal(handled, true)

      const inserted = h.store.getState().document.tracks[0].clips.find(c => c.id === 'new-1')
      assert.ok(inserted, 'inserted clip should exist on track 0')
      assert.equal(inserted!.startMs, 5000)
      assert.equal(inserted!.endMs, 6000)
      assert.equal(inserted!.durationMs, 1000)
      assert.equal(inserted!.resource, 'new.mov')
    })

    it('drop without an id generates one and raises sub-100ms durations to 100ms', () => {
      const h = createHarness(fixtureDoc())
      h.externalItem.current = { type: 'video', name: 'Blip', durationMs: 10 }

      h.interactions.handleDrop(dropEvent(fakeHit({ zone: 'track-empty', x: 400, y: 52, trackIndex: 0 })))

      const inserted = h.store.getState().document.tracks[0].clips.find(c => c.name === 'Blip')
      assert.ok(inserted)
      assert.ok(/^clip-/.test(inserted!.id), `generated id ${inserted!.id} should start with clip-`)
      assert.equal(inserted!.endMs - inserted!.startMs, 100)
    })

    it('drop onto an occupied span creates a new track at the hovered position', () => {
      const h = createHarness(fixtureDoc())
      h.externalItem.current = { id: 'ovl', type: 'video', name: 'Overlap', durationMs: 1000 }

      h.interactions.handleDrop(dropEvent(fakeHit({ zone: 'track-empty', x: 130, y: 52, trackIndex: 0 })))

      const tracks = h.store.getState().document.tracks
      assert.equal(tracks.length, 4)
      assert.deepEqual(tracks[1].clips.map(c => c.id), ['ovl'])
    })

    it('drag leave clears the overlay', () => {
      const h = createHarness(fixtureDoc())
      h.externalItem.current = { type: 'video', name: 'Intro', durationMs: 1000 }
      dragOver(h, fakeHit({ zone: 'track-empty', x: 200, y: 52, trackIndex: 0 }))
      assert.notEqual(h.mock.getOverlay().dragPreview, undefined)
      const before = h.mock.clearOverlayCount()
      h.interactions.handleDragLeave()
      assert.equal(h.mock.clearOverlayCount(), before + 1)
      assert.deepEqual(h.mock.getOverlay(), {})
    })
  })

  describe('shortcuts', () => {
    it('Delete and Backspace remove the selected clip; selection is cleared afterwards', () => {
      const h = createHarness(fixtureDoc())
      h.bus.execute('selection:set', { clipId: 'a' })
      assert.equal(h.interactions.handleKeyDown(keyEvent('Delete')), true)
      assert.deepEqual(trackClipIds(h.store, 0), ['b'])
      assert.equal(h.store.getState().selection.clipId, null)

      // Emptied track 0 is removed; the audio track is sorted below the locked video track.
      h.bus.execute('selection:set', { clipId: 'b' })
      assert.equal(h.interactions.handleKeyDown(keyEvent('Backspace')), true)
      assert.deepEqual(trackClipIds(h.store, 0), ['L'])
      assert.equal(h.store.getState().document.tracks.length, 2)
    })

    it('Mod+Z undoes, and both Mod+Shift+Z and Ctrl+Y redo', () => {
      const h = createHarness(fixtureDoc())
      h.bus.execute('selection:set', { clipId: 'a' })
      h.interactions.handleKeyDown(keyEvent('Delete'))
      assert.deepEqual(trackClipIds(h.store, 0), ['b'])

      assert.equal(h.interactions.handleKeyDown(keyEvent('z', { metaKey: true })), true)
      assert.deepEqual(trackClipIds(h.store, 0), ['a', 'b'])

      assert.equal(h.interactions.handleKeyDown(keyEvent('Z', { metaKey: true, shiftKey: true })), true)
      assert.deepEqual(trackClipIds(h.store, 0), ['b'])

      assert.equal(h.interactions.handleKeyDown(keyEvent('z', { ctrlKey: true })), true)
      assert.deepEqual(trackClipIds(h.store, 0), ['a', 'b'])

      assert.equal(h.interactions.handleKeyDown(keyEvent('y', { ctrlKey: true })), true)
      assert.deepEqual(trackClipIds(h.store, 0), ['b'])
    })

    it('Mod+B splits the selected clip at the playhead frame', () => {
      const h = createHarness(fixtureDoc())
      h.store.setCurrentFrame(12) // 500ms at 24 fps
      h.bus.execute('selection:set', { clipId: 'a' })

      assert.equal(h.interactions.handleKeyDown(keyEvent('b', { metaKey: true })), true)
      const clips = h.store.getState().document.tracks[0].clips
      assert.deepEqual(clips.map(c => [c.startMs, c.endMs]), [[0, 500], [500, 2000], [3000, 3500]])
    })

    it('disabling shortcuts makes the keys inert', () => {
      const h = createHarness(fixtureDoc(), { shortcuts: false })
      h.bus.execute('selection:set', { clipId: 'a' })
      assert.equal(h.interactions.handleKeyDown(keyEvent('Delete')), false)
      assert.deepEqual(trackClipIds(h.store, 0), ['a', 'b'])
    })

    it('a null binding in the keymap removes that default shortcut only', () => {
      const h = createHarness(fixtureDoc(), { shortcuts: { keymap: { Delete: null } } })
      h.bus.execute('selection:set', { clipId: 'a' })
      assert.equal(h.interactions.handleKeyDown(keyEvent('Delete')), false)
      assert.equal(h.interactions.handleKeyDown(keyEvent('Backspace')), true)
      assert.deepEqual(trackClipIds(h.store, 0), ['b'])
    })

    it('keys typed into editable elements are not intercepted', () => {
      const h = createHarness(fixtureDoc())
      h.bus.execute('selection:set', { clipId: 'a' })
      const inInput = keyEvent('Delete', { target: { tagName: 'INPUT' } })
      assert.equal(h.interactions.handleKeyDown(inInput), false)
      assert.deepEqual(trackClipIds(h.store, 0), ['a', 'b'])
    })

    it('the shortcuts plugin exposes an empty keymap when disabled and the merged defaults otherwise', () => {
      const disabled = createShortcutsPlugin({ enabled: false })
      assert.deepEqual(disabled.keymap, {})
      const enabled = createShortcutsPlugin()
      assert.equal(enabled.keymap?.['Mod+Z'], 'history:undo')
    })
  })

  describe('snap providers', () => {
    const doc = fixtureDoc()
    const layout = computeTimelineLayout(doc, { trackScale: 50 })

    it('the playhead provider places a snap point at the current frame time and pixel', () => {
      const points = playheadSnapProvider.getSnapPoints({
        layout,
        currentFrame: 24,
        excludeClipIds: new Set(),
        targetLeftPx: 0,
        durationMs: 0,
      })
      assert.deepEqual(points, [{ timeMs: 1000, x: 40, source: 'playhead', kind: 'playhead' }])
    })

    it('the clip edge provider emits start and end edges for every clip except excluded ones', () => {
      const points = clipEdgeSnapProvider.getSnapPoints({
        layout,
        currentFrame: 0,
        excludeClipIds: new Set(['a']),
        targetLeftPx: 0,
        durationMs: 0,
      })
      assert.equal(points.length, 6)
      assert.ok(points.every(p => p.clipId !== 'a'))
      const b = points.filter(p => p.clipId === 'b').map(p => [p.kind, p.x])
      assert.deepEqual(b, [['start', 120], ['end', 140]])
    })

    it('the grid provider emits nearby grid lines for both edges and honours the enabled gate', () => {
      const grid = createGridSnapProvider({ stepMs: 500, enabled: () => true })
      const times = grid.getSnapPoints({
        layout,
        currentFrame: 0,
        excludeClipIds: new Set(),
        targetLeftPx: 0,
        durationMs: 1000,
      }).map(p => p.timeMs).sort((x, y) => x - y)
      assert.deepEqual(times, [0, 500, 1000, 1500, 2000])

      const off = createGridSnapProvider({ stepMs: 500, enabled: () => false })
      assert.deepEqual(off.getSnapPoints({
        layout,
        currentFrame: 0,
        excludeClipIds: new Set(),
        targetLeftPx: 0,
        durationMs: 1000,
      }), [])
    })

    it('the grid provider clamps the step to at least 10ms and the radius to at least one step', () => {
      const tiny = createGridSnapProvider({ stepMs: 3, radiusSteps: 0 })
      const times = Array.from(new Set(tiny.getSnapPoints({
        layout,
        currentFrame: 0,
        excludeClipIds: new Set(),
        targetLeftPx: 0,
        durationMs: 0,
      }).map(p => p.timeMs))).sort((x, y) => x - y)
      assert.deepEqual(times, [0, 10])
    })
  })

  describe('plugin lifecycle', () => {
    it('removing plugins takes their interaction handlers out of the pipeline, falling through to the next claimant', () => {
      const h = createHarness(fixtureDoc())
      const down = clipHit(h.layout(), 0, 0)
      assert.equal(h.interactions.hasPlugin('builtin:clip-drag'), true)

      // The selection plugin also claims clip bodies (returning an empty session), so it must go too.
      h.interactions.remove('builtin:clip-drag')
      assert.equal(h.interactions.handlePointerDown(pointer(down, 100, 52)), true)
      h.interactions.cancelActiveSession()

      h.interactions.remove('builtin:selection')
      assert.equal(h.interactions.handlePointerDown(pointer(down, 100, 52)), false)
    })

    it('an individual plugin can be composed without the defaults', () => {
      const store = new TimelineStore({ document: fixtureDoc() })
      const bus = new CommandBus({ store, getPolicies: () => POLICIES })
      registerBuiltinCommands(bus)
      const mock = createMockRenderer(store)
      const interactions = new InteractionManager({ store, commands: bus, renderer: mock.port, getPolicies: () => POLICIES })
      interactions.use(createSelectionPlugin())
      interactions.use(createClipTrimPlugin())
      interactions.use(createClipDragPlugin())
      assert.equal(interactions.hasPlugin('builtin:selection'), true)
      assert.equal(interactions.handlePointerDown(pointer(clipHit(mock.port.getLayout(), 0, 0), 100, 52)), true)
      interactions.destroy()
      assert.equal(interactions.hasActiveSession(), false)
      assert.equal(interactions.hasPlugin('builtin:clip-drag'), false)
    })
  })
})
