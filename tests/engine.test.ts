import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  collectSnapPoints,
  computeTimelineLayout,
  computeVisibleRange,
  filterVisibleClips,
  findBestSnap,
  getFramePixel,
  getGridSize,
  getPixelsPerSecond,
  hitTestLayout,
  pxToFrame,
} from '../src/engine'
import {
  clipEdgeSnapProvider,
  createGridSnapProvider,
  playheadSnapProvider,
} from '../src/plugins'
import type { TimelineDocument } from '../src/model'

function createEngineTestDoc(): TimelineDocument {
  const clips = Array.from({ length: 20 }, (_, i) => ({
    id: `c-${i}`,
    type: 'video',
    name: `Clip ${i}`,
    startMs: i * 5000,
    endMs: i * 5000 + 4000,
  }))
  return {
    id: 'engine-doc',
    name: 'Engine Doc',
    fps: 24,
    tracks: [
      { id: 't1', type: 'video', name: 'V1', clips },
      { id: 't2', type: 'audio', name: 'A1', clips: [{ id: 'a1', type: 'audio', name: 'BGM', startMs: 0, endMs: 20000 }] },
    ],
  }
}

describe('engine', () => {
  it('computes monotonic pixelsPerSecond across continuous scales and uses actual fps', () => {
    let prevPps24 = 0
    for (let scale = 0; scale <= 100; scale += 2) {
      const pps = getPixelsPerSecond(scale, 24)
      assert.ok(pps > prevPps24, `pps should strictly increase at scale ${scale}`)
      prevPps24 = pps
    }

    assert.equal(getGridSize(50, 24), 40)
    assert.equal(getPixelsPerSecond(50, 24), 40)
    assert.equal(getPixelsPerSecond(70, 24), 240)
    assert.equal(getPixelsPerSecond(70, 60), 600)

    // Verify pxToFrame uses actual fps (24 vs 60)
    const oneSecPx24 = getPixelsPerSecond(50, 24)
    assert.equal(pxToFrame(oneSecPx24, 50, 24), 24)
    const oneSecPx60 = getPixelsPerSecond(50, 60)
    assert.equal(pxToFrame(oneSecPx60, 50, 60), 60)
    assert.ok(Math.abs(getFramePixel(50, 24) * 24 - 40) < 1e-6)
  })

  it('virtualizes visible clips horizontally while always keeping selected/pinned clip ids', () => {
    const doc = createEngineTestDoc()
    const layout = computeTimelineLayout(doc, {
      trackScale: 50,
      trackConfigs: { video: { height: 64 }, audio: { height: 56 } },
    })

    // Viewport width 600px at scrollLeft = 0 -> ~0..21s visible (with 240px overscan)
    const range = computeVisibleRange(0, 600, layout.pixelsPerSecond, 10, 240)
    const visible = filterVisibleClips(layout.tracks[0].clips, range, new Set(['c-18']))
    assert.ok(visible.length < layout.tracks[0].clips.length)
    assert.ok(visible.some(c => c.clip.id === 'c-0'))
    assert.ok(visible.some(c => c.clip.id === 'c-18')) // alwaysIncludeIds preserved
    assert.equal(visible.some(c => c.clip.id === 'c-15'), false)
  })

  it('collects snap points from built-in and grid providers and snaps both start and end edges', () => {
    const doc = createEngineTestDoc()
    const layout = computeTimelineLayout(doc, { trackScale: 50 })

    const gridProvider = createGridSnapProvider({ stepMs: 500, enabled: () => true })
    const points = collectSnapPoints(
      [playheadSnapProvider, clipEdgeSnapProvider, gridProvider],
      {
        layout,
        currentFrame: 48, // 2000ms = 80px
        excludeClipIds: new Set(['c-0']),
        targetLeftPx: 76,
        durationMs: 1000,
      },
    )

    const snapPlayhead = findBestSnap(76, 1000, points, layout.pixelsPerSecond, 10)
    assert.ok(snapPlayhead)
    assert.equal(snapPlayhead!.startMs, 2000)
    assert.equal(snapPlayhead!.edge, 'start')

    // End edge near 5000ms (200px) with 1000ms (40px) duration -> left ~ 157px -> right ~ 197px
    const snapEnd = findBestSnap(157, 1000, points, layout.pixelsPerSecond, 10)
    assert.ok(snapEnd)
    assert.equal(snapEnd!.edge, 'end')
    assert.equal(snapEnd!.guidelineX, 200)
  })

  it('performs pure coordinate hit-testing across body, trim handles, and empty track areas', () => {
    const doc = createEngineTestDoc()
    const layout = computeTimelineLayout(doc, {
      trackScale: 50,
      trackConfigs: { video: { height: 64 }, audio: { height: 56 } },
    })

    const trackMidY = (layout.tracks[0].startY + layout.tracks[0].endY) / 2
    const c1 = layout.tracks[0].clips[1] // starts at 5000ms = 200px, width 160px

    const hitStart = hitTestLayout(layout, doc, { x: c1.leftPx - 2, y: trackMidY })
    assert.equal(hitStart.zone, 'trim-start')
    assert.equal(hitStart.clipId, 'c-1')

    const hitBody = hitTestLayout(layout, doc, { x: c1.leftPx + 40, y: trackMidY })
    assert.equal(hitBody.zone, 'clip-body')
    assert.equal(hitBody.clipId, 'c-1')

    const hitEnd = hitTestLayout(layout, doc, { x: c1.leftPx + c1.widthPx + 2, y: trackMidY })
    assert.equal(hitEnd.zone, 'trim-end')
    assert.equal(hitEnd.clipId, 'c-1')

    const hitEmpty = hitTestLayout(layout, doc, { x: c1.leftPx - 25, y: trackMidY })
    assert.equal(hitEmpty.zone, 'track-empty')
    assert.equal(hitEmpty.clipId, null)
    assert.equal(hitEmpty.trackIndex, 0)
  })
})
