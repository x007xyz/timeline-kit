import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  calculateMagnetArrangement,
  checkTrackOverlap,
  computeTimelineLayout,
  detectMagnetState,
  frameToMs,
  frameToSeconds,
  getFramePixel,
  getGridSize,
  getMagnetPreviewTransforms,
  getPixelsPerSecond,
  isMagnetTrack,
  msToFrame,
  msToPx,
  pxToFrame,
  pxToMs,
  resolveTargetTrack,
  scaleToPixelsPerSecond,
  secondsToFrame,
  clampTrackScale,
  type LayoutTrack,
} from '../src/engine'
import type { EditPolicies, TimelineClip, TimelineDocument, TimelineTrack } from '../src/model'

function near(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`)
}

function clip(id: string, startMs: number, endMs: number, type = 'video'): TimelineClip {
  return { id, type, name: id, startMs, endMs }
}

function track(id: string, type: string, clips: TimelineClip[], extra: Partial<TimelineTrack> = {}): TimelineTrack {
  return { id, type, name: id, clips, ...extra }
}

const POLICIES: EditPolicies = {
  allowOverlap: false,
  allowCrossTrackType: false,
  removeEmptyTracks: true,
  orderAudioToBottom: true,
}

describe('engine magnet, placement, layout and timeScale', () => {
  describe('magnet: isMagnetTrack', () => {
    it('is true only for a main track while magnet mode is enabled', () => {
      const main = track('m', 'video', [], { main: true })
      assert.equal(isMagnetTrack(main, true), true)
      assert.equal(isMagnetTrack(main, false), false)
      assert.equal(isMagnetTrack(track('o', 'video', []), true), false)
      assert.equal(isMagnetTrack(undefined, true), false)
    })
  })

  describe('magnet: calculateMagnetArrangement (time-based, no layout)', () => {
    it('inserts before a clip whose midpoint is after the drop and shifts the following clip', () => {
      const t = track('t', 'video', [clip('A', 0, 1000), clip('B', 2000, 3000)], { main: true })
      const result = calculateMagnetArrangement(t, 1500, 500, 0)

      assert.equal(result.insertPosition, 1)
      assert.deepEqual(result.newArrangement.map(c => [c.id, c.startMs, c.endMs]), [
        ['A', 0, 1000],
        ['B', 1500, 2500],
      ])
      assert.deepEqual(result.affectedClips, [{
        clipId: 'B',
        originalStartMs: 2000,
        originalEndMs: 3000,
        newStartMs: 1500,
        newEndMs: 2500,
      }])
    })

    it('inserts at index 0 when the drop starts in the first half of the first clip', () => {
      const t = track('t', 'video', [clip('A', 0, 1000), clip('B', 2000, 3000)], { main: true })
      const result = calculateMagnetArrangement(t, 400, 500, 0)
      assert.equal(result.insertPosition, 0)
      assert.deepEqual(result.affectedClips.map(a => a.clipId), ['A', 'B'])
    })

    it('chooses the slot after a clip when the drop starts in its second half', () => {
      const t = track('t', 'video', [clip('A', 0, 1000), clip('B', 2000, 3000)], { main: true })
      const result = calculateMagnetArrangement(t, 600, 500, 0)
      assert.equal(result.insertPosition, 1)
    })

    it('reports no affected clips when the packing is already tight at the end', () => {
      const t = track('t', 'video', [clip('A', 0, 1000), clip('B', 1000, 2000)], { main: true })
      const result = calculateMagnetArrangement(t, 2000, 500, 0)
      assert.equal(result.insertPosition, 2)
      assert.deepEqual(result.affectedClips, [])
    })

    it('closes an existing gap when a clip is dropped after it and reports the shifted clip', () => {
      const t = track('t', 'video', [clip('A', 0, 1000), clip('B', 3000, 4000)], { main: true })
      const result = calculateMagnetArrangement(t, 5000, 500, 0)
      assert.equal(result.insertPosition, 2)
      assert.deepEqual(result.newArrangement.map(c => [c.id, c.startMs, c.endMs]), [
        ['A', 0, 1000],
        ['B', 1000, 2000],
      ])
      assert.deepEqual(result.affectedClips.map(a => [a.clipId, a.newStartMs]), [['B', 1000]])
    })

    it('places the dropped gap between clips without moving the leading clip', () => {
      const t = track('t', 'video', [clip('A', 0, 1000), clip('B', 3000, 4000)], { main: true })
      const result = calculateMagnetArrangement(t, 1500, 500, 0)
      assert.equal(result.insertPosition, 1)
      assert.deepEqual(result.affectedClips.map(a => [a.clipId, a.newStartMs]), [['B', 1500]])
    })

    it('handles an empty track: no arrangement, no affected clips', () => {
      const result = calculateMagnetArrangement(track('t', 'video', [], { main: true }), 0, 500, 0)
      assert.equal(result.insertPosition, 0)
      assert.deepEqual(result.newArrangement, [])
      assert.deepEqual(result.affectedClips, [])
    })

    it('treats a zero-length dragged clip as occupying no time', () => {
      const t = track('t', 'video', [clip('A', 0, 1000), clip('B', 1000, 2000)], { main: true })
      const result = calculateMagnetArrangement(t, 0, 0, 0)
      assert.equal(result.insertPosition, 0)
      assert.deepEqual(result.newArrangement.map(c => [c.id, c.startMs]), [['A', 0], ['B', 1000]])
    })

    it('excludes the dragged clip from the arrangement when excludeClipId is given', () => {
      const t = track('t', 'video', [clip('A', 0, 1000), clip('B', 1000, 2000)], { main: true })
      const result = calculateMagnetArrangement(t, 1000, 500, 0, undefined, 'B')
      assert.deepEqual(result.newArrangement.map(c => c.id), ['A'])
      assert.equal(result.insertPosition, 1)
      assert.deepEqual(result.affectedClips, [])
    })

    it('sorts unsorted input and packs overlapping clips into a non-overlapping sequence', () => {
      const t = track('t', 'video', [clip('B', 500, 1500), clip('A', 0, 1000)], { main: true })
      const result = calculateMagnetArrangement(t, 9999, 100, 0)
      assert.equal(result.insertPosition, 2)
      const starts = result.newArrangement.map(c => c.startMs)
      const ends = result.newArrangement.map(c => c.endMs)
      assert.deepEqual(result.newArrangement.map(c => c.id), ['A', 'B'])
      assert.deepEqual(starts, [0, 1000])
      assert.deepEqual(ends, [1000, 2000])
    })

    it('keeps an inverted clip (endMs < startMs) at zero length instead of going negative', () => {
      const t = track('t', 'video', [clip('X', 2000, 1000)], { main: true })
      const result = calculateMagnetArrangement(t, 0, 100, 0)
      const x = result.newArrangement.find(c => c.id === 'X')!
      assert.equal(x.startMs, 100)
      assert.equal(x.endMs, 100)
    })
  })

  describe('magnet: calculateMagnetArrangement (layout-aware, cursor based)', () => {
    const layoutClips = [
      { clip: clip('A', 0, 1000), leftPx: 0, widthPx: 100 },
      { clip: clip('B', 2000, 3000), leftPx: 200, widthPx: 100 },
    ] as unknown as LayoutTrack['clips']

    it('uses the cursor position over the layout: left half of A inserts at 0, right half inserts after A', () => {
      const t = track('t', 'video', [clip('A', 0, 1000), clip('B', 2000, 3000)], { main: true })
      const layout = { clips: layoutClips }
      assert.equal(calculateMagnetArrangement(t, 0, 500, 50, layout).insertPosition, 0)
      assert.equal(calculateMagnetArrangement(t, 0, 500, 80, layout).insertPosition, 1)
    })

    it('inserts before the next clip when the cursor sits in the gap before it', () => {
      const t = track('t', 'video', [clip('A', 0, 1000), clip('B', 2000, 3000)], { main: true })
      const result = calculateMagnetArrangement(t, 0, 500, 150, { clips: layoutClips })
      assert.equal(result.insertPosition, 1)
    })

    it('skips clips that have no layout entry rather than failing', () => {
      const t = track('t', 'video', [clip('A', 0, 1000), clip('B', 2000, 3000)], { main: true })
      const onlyB = { clips: [layoutClips[1]] }
      assert.equal(calculateMagnetArrangement(t, 0, 500, 250, onlyB).insertPosition, 1)
      assert.equal(calculateMagnetArrangement(t, 0, 500, 260, onlyB).insertPosition, 2)
    })
  })

  describe('magnet: detectMagnetState', () => {
    const tracks = [
      track('main', 'video', [clip('A', 0, 1000), clip('B', 2000, 3000)], { main: true }),
      track('side', 'video', []),
    ]
    const baseOptions = {
      tracks,
      tracksLayout: [undefined, undefined] as Array<undefined>,
      targetTrackIndex: 0,
      isNewTrack: false,
      targetX: 150,
      cursorX: 150,
      dragClipDurationMs: 500,
      sourceTrackIndex: 1,
      sourceClipId: 'X',
      pixelToMs: (px: number) => px * 10,
      magnetEnabled: true,
    }

    it('reports why magnet mode is off for new tracks, invalid tracks, non-main tracks, and disabled magnet', () => {
      assert.deepEqual(detectMagnetState({ ...baseOptions, isNewTrack: true }), { isMagnetMode: false, reason: 'new-track' })
      assert.deepEqual(detectMagnetState({ ...baseOptions, targetTrackIndex: 9 }), { isMagnetMode: false, reason: 'invalid-track' })
      assert.deepEqual(detectMagnetState({ ...baseOptions, targetTrackIndex: 1 }), { isMagnetMode: false, reason: 'non-magnet-track' })
      assert.deepEqual(detectMagnetState({ ...baseOptions, magnetEnabled: false }), { isMagnetMode: false, reason: 'magnet-disabled' })
    })

    it('computes the insert position from the pixel-to-ms conversion of the target X', () => {
      const result = detectMagnetState(baseOptions)
      assert.equal(result.isMagnetMode, true)
      assert.equal(result.magnetState!.targetTrackIndex, 0)
      assert.equal(result.magnetState!.insertPosition, 1)
      assert.equal(result.magnetState!.dragClipDurationMs, 500)
      assert.deepEqual(result.magnetState!.previewArrangement.map(c => c.id), ['A', 'B'])
    })

    it('excludes the dragged clip when the source and target are the same track', () => {
      const result = detectMagnetState({
        ...baseOptions,
        sourceTrackIndex: 0,
        sourceClipId: 'A',
        targetX: 150,
      })
      assert.equal(result.isMagnetMode, true)
      assert.deepEqual(result.magnetState!.previewArrangement.map(c => c.id), ['B'])
      assert.equal(result.magnetState!.insertPosition, 0)
    })
  })

  describe('magnet: getMagnetPreviewTransforms', () => {
    const layoutTrack = {
      clips: [
        { clip: clip('A', 0, 1000), leftPx: 0, widthPx: 40 },
        { clip: clip('B', 1000, 2000), leftPx: 40, widthPx: 40 },
      ],
    } as unknown as Pick<LayoutTrack, 'clips'>

    it('returns no transforms without a target layout or with an empty layout', () => {
      const state = calculateMagnetArrangement(track('t', 'video', []), 0, 500, 0)
      const magnetState = {
        isEnabled: true,
        targetTrackIndex: 0,
        insertPosition: state.insertPosition,
        dragClipDurationMs: 500,
        affectedClips: state.affectedClips,
        previewArrangement: state.newArrangement,
      }
      assert.deepEqual(getMagnetPreviewTransforms(magnetState, 'X', px => px, undefined), [])
      assert.deepEqual(getMagnetPreviewTransforms(magnetState, 'X', px => px, { clips: [] }), [])
    })

    it('produces pixel offsets for every existing clip that the preview moves, and never for the dragged clip', () => {
      const t = track('t', 'video', [clip('A', 0, 1000), clip('B', 1000, 2000)], { main: true })
      const state = calculateMagnetArrangement(t, 0, 500, 0)
      const magnetState = {
        isEnabled: true,
        targetTrackIndex: 0,
        insertPosition: state.insertPosition,
        dragClipDurationMs: 500,
        affectedClips: state.affectedClips,
        previewArrangement: state.newArrangement,
      }
      const transforms = getMagnetPreviewTransforms(magnetState, 'X', ms => msToPx(ms, 40), layoutTrack)
      assert.deepEqual(transforms, [
        { clipId: 'A', offsetX: 20 },
        { clipId: 'B', offsetX: 20 },
      ])
      assert.ok(!transforms.some(t => t.clipId === 'X'))
    })
  })

  describe('placement: checkTrackOverlap', () => {
    const tracks = [
      track('v', 'video', [clip('a', 0, 1000), clip('b', 2000, 3000)]),
      track('m', 'video', [clip('c', 0, 1000)], { main: true }),
    ]

    it('never reports overlap when allowOverlap is set', () => {
      assert.equal(checkTrackOverlap(tracks, 0, 0, 500, undefined, { ...POLICIES, allowOverlap: true }), false)
    })

    it('reports overlap only for strictly intersecting ranges; touching edges do not overlap', () => {
      assert.equal(checkTrackOverlap(tracks, 0, 500, 1500), true)
      assert.equal(checkTrackOverlap(tracks, 0, 1000, 2000), false)
      assert.equal(checkTrackOverlap(tracks, 0, 999, 1001), true)
    })

    it('ignores the excluded clip id', () => {
      assert.equal(checkTrackOverlap(tracks, 0, 500, 1500, 'a'), false)
    })

    it('returns false for an out-of-range track and for a magnet track', () => {
      assert.equal(checkTrackOverlap(tracks, 9, 0, 500), false)
      assert.equal(checkTrackOverlap(tracks, 1, 0, 500, undefined, POLICIES, true), false)
      assert.equal(checkTrackOverlap(tracks, 1, 0, 500, undefined, POLICIES, false), true)
    })
  })

  describe('placement: resolveTargetTrack', () => {
    const tracks = [
      track('v', 'video', [clip('a', 0, 1000), clip('b', 2000, 3000)]),
      track('au', 'audio', []),
    ]
    const tracksLayout = [
      { startY: 20, endY: 84, type: 'video' },
      { startY: 88, endY: 152, type: 'audio' },
    ] as Array<Pick<LayoutTrack, 'startY' | 'endY' | 'type'>>
    const dragVideo = { id: 'x', type: 'video', startMs: 0, endMs: 500 }
    const opts = { targetStartMs: 1500, magnetEnabled: false, policies: POLICIES }

    it('keeps a clip on the hovered track when the span is free; touching a neighbour is allowed', () => {
      assert.deepEqual(resolveTargetTrack(tracks, tracksLayout, 50, dragVideo, opts), { isNewTrack: false, insertIndex: 0 })
    })

    it('falls back to a new track at the top half boundary when the span overlaps', () => {
      const overlap = { ...opts, targetStartMs: 1800 }
      assert.deepEqual(resolveTargetTrack(tracks, tracksLayout, 50, dragVideo, overlap), { isNewTrack: true, insertIndex: 0 })
      assert.deepEqual(resolveTargetTrack(tracks, tracksLayout, 80, dragVideo, overlap), { isNewTrack: true, insertIndex: 1 })
    })

    it('creates a new track when the dragged type does not match and cross-type drops are disallowed', () => {
      const audioClip = { id: 'x', type: 'audio', startMs: 0, endMs: 500 }
      assert.deepEqual(resolveTargetTrack(tracks, tracksLayout, 50, audioClip, opts), { isNewTrack: true, insertIndex: 0 })
      assert.deepEqual(
        resolveTargetTrack(tracks, tracksLayout, 50, audioClip, { ...opts, policies: { ...POLICIES, allowCrossTrackType: true } }),
        { isNewTrack: false, insertIndex: 0 },
      )
    })

    it('treats a locked track as a drop target that is not allowed and inserts a new track beside it', () => {
      const lockedTracks = [{ ...tracks[0], locked: true }, tracks[1]]
      assert.deepEqual(resolveTargetTrack(lockedTracks, tracksLayout, 50, dragVideo, opts), { isNewTrack: true, insertIndex: 0 })
      assert.deepEqual(
        resolveTargetTrack([tracks[0], { ...tracks[1], locked: true }], tracksLayout, 110, { id: 'x', type: 'audio', startMs: 0, endMs: 500 }, opts),
        { isNewTrack: true, insertIndex: 1 },
      )
    })

    it('honours the canDrop policy', () => {
      const denied = { ...opts, policies: { ...POLICIES, canDrop: () => false } }
      assert.deepEqual(resolveTargetTrack(tracks, tracksLayout, 50, dragVideo, denied), { isNewTrack: true, insertIndex: 0 })
    })

    it('inserts directly into a magnet track without overlap checks', () => {
      const magnetTracks = [{ ...tracks[0], main: true }, tracks[1]]
      const overlap = { ...opts, targetStartMs: 1800, magnetEnabled: true }
      assert.deepEqual(resolveTargetTrack(magnetTracks, tracksLayout, 50, dragVideo, overlap), { isNewTrack: false, insertIndex: 0 })
    })

    it('treats the vertical gap between tracks as a new-track insertion point', () => {
      assert.deepEqual(resolveTargetTrack(tracks, tracksLayout, 86, dragVideo, opts), { isNewTrack: true, insertIndex: 1 })
    })

    it('treats positions above the first and below the last track as new tracks at the edges', () => {
      assert.deepEqual(resolveTargetTrack(tracks, tracksLayout, 5, dragVideo, opts), { isNewTrack: true, insertIndex: 0 })
      assert.deepEqual(resolveTargetTrack(tracks, tracksLayout, 500, dragVideo, opts), { isNewTrack: true, insertIndex: 2 })
    })

    it('returns a new track at index 0 when there are no track layouts', () => {
      assert.deepEqual(resolveTargetTrack([], [], 10, dragVideo, opts), { isNewTrack: true, insertIndex: 0 })
    })

    it('clamps a negative target start to 0 before checking the span', () => {
      const audioClip = { id: 'x', type: 'audio', startMs: 0, endMs: 500 }
      const result = resolveTargetTrack(tracks, tracksLayout, 110, audioClip, {
        ...opts,
        targetStartMs: -200,
        policies: { ...POLICIES, allowCrossTrackType: true },
      })
      assert.deepEqual(result, { isNewTrack: false, insertIndex: 1 })
    })
  })

  describe('layout: computeTimelineLayout', () => {
    it('lays out an empty document with only top padding on each side', () => {
      const doc: TimelineDocument = { id: 'e', name: 'E', fps: 0, tracks: [] }
      const layout = computeTimelineLayout(doc, { trackScale: 50 })
      assert.equal(layout.fps, 24)
      assert.deepEqual(layout.tracks, [])
      assert.equal(layout.contentTop, 20)
      assert.equal(layout.contentHeight, 40)
      assert.equal(layout.totalDurationMs, 0)
    })

    it('stacks tracks with the default height and gap, and applies per-type height overrides', () => {
      const doc: TimelineDocument = {
        id: 'd',
        name: 'D',
        fps: 24,
        tracks: [track('v', 'video', []), track('a', 'audio', [])],
      }
      const layout = computeTimelineLayout(doc, { trackScale: 50 })
      assert.deepEqual(layout.tracks.map(t => [t.startY, t.endY, t.height]), [[20, 84, 64], [88, 152, 64]])
      assert.equal(layout.contentHeight, 152 + 20)

      const tall = computeTimelineLayout(doc, { trackScale: 50, trackConfigs: { audio: { height: 56 } } })
      assert.deepEqual(tall.tracks.map(t => [t.startY, t.endY, t.height]), [[20, 84, 64], [88, 144, 56]])
    })

    it('falls back to the default height for zero or negative configured heights', () => {
      const doc: TimelineDocument = { id: 'd', name: 'D', fps: 24, tracks: [track('v', 'video', [])] }
      assert.equal(computeTimelineLayout(doc, { trackScale: 50, trackConfigs: { video: { height: 0 } } }).tracks[0].height, 64)
      assert.equal(computeTimelineLayout(doc, { trackScale: 50, trackConfigs: { video: { height: -4 } } }).tracks[0].height, 64)
    })

    it('centers the stack when the viewport is taller than the content, and keeps padding when it is shorter', () => {
      const doc: TimelineDocument = {
        id: 'c',
        name: 'C',
        fps: 24,
        tracks: [track('v', 'video', []), track('a', 'audio', [])],
      }
      const centered = computeTimelineLayout(doc, { trackScale: 50, viewportHeight: 400 })
      assert.equal(centered.tracks[0].startY, (400 - 132) / 2)
      assert.equal(centered.contentTop, (400 - 132) / 2)

      const cramped = computeTimelineLayout(doc, { trackScale: 50, viewportHeight: 100 })
      assert.equal(cramped.tracks[0].startY, 20)
    })

    it('honours custom gap and padding options', () => {
      const doc: TimelineDocument = {
        id: 'g',
        name: 'G',
        fps: 24,
        tracks: [track('v', 'video', []), track('a', 'audio', [])],
      }
      const layout = computeTimelineLayout(doc, { trackScale: 50, trackGap: 10, paddingTop: 0 })
      assert.deepEqual(layout.tracks.map(t => t.startY), [0, 74])
    })

    it('converts clip times to pixels, clamps negative starts, and collapses inverted ranges to zero width', () => {
      const doc: TimelineDocument = {
        id: 'p',
        name: 'P',
        fps: 24,
        tracks: [track('v', 'video', [
          clip('a', 1000, 3000),
          clip('neg', -500, 1000),
          clip('inv', 2000, 1000),
          { id: 'untyped', type: '', name: 'u', startMs: 0, endMs: 500 },
        ])],
      }
      const layout = computeTimelineLayout(doc, { trackScale: 50 })
      const [a, neg, inv, untyped] = layout.tracks[0].clips
      assert.equal(a.leftPx, 40)
      assert.equal(a.widthPx, 80)
      assert.equal(neg.startMs, 0)
      assert.equal(neg.endMs, 1000)
      assert.equal(neg.leftPx, 0)
      assert.equal(neg.widthPx, 40)
      assert.equal(inv.endMs, inv.startMs)
      assert.equal(inv.widthPx, 0)
      assert.equal(untyped.type, 'video')
    })

    it('reports total duration and frame pixel from the document and scale', () => {
      const doc: TimelineDocument = {
        id: 'dur',
        name: 'Dur',
        fps: 24,
        tracks: [track('v', 'video', [clip('a', 0, 5000)])],
      }
      const layout = computeTimelineLayout(doc, { trackScale: 50 })
      assert.equal(layout.totalDurationMs, 5000)
      assert.equal(layout.totalDurationSec, 5)
      near(layout.framePixel, 40 / 24)
      assert.equal(layout.pixelsPerSecond, 40)
    })
  })

  describe('timeScale helpers', () => {
    it('clamps non-finite and out-of-range track scales', () => {
      assert.equal(clampTrackScale(Number.NaN), 50)
      assert.equal(clampTrackScale(Number.POSITIVE_INFINITY), 50)
      assert.equal(clampTrackScale(-5), 0)
      assert.equal(clampTrackScale(150), 100)
      assert.equal(clampTrackScale(33), 33)
    })

    it('uses fixed stops at the ends and interpolates linearly between stops', () => {
      near(getPixelsPerSecond(0, 24), 10 / 6)
      near(getPixelsPerSecond(100, 24), 2400)
      near(getPixelsPerSecond(50, 24), 40)
      near(getPixelsPerSecond(5, 24), (10 / 6 + 25 / 6) / 2)
      near(getPixelsPerSecond(95, 24), (1200 + 2400) / 2)
    })

    it('falls back to 24 fps for non-positive frame rates', () => {
      near(getPixelsPerSecond(70, 0), 240)
      near(getFramePixel(100, 0), 100)
      near(scaleToPixelsPerSecond(100), 3000)
    })

    it('chooses grid sizes that match the zoom band', () => {
      near(getGridSize(20, 24), 40) // (40 / 6) px/s * 6 seconds per grid cell
      near(getGridSize(50, 24), 40)
      near(getGridSize(80, 24), 20)
    })

    it('converts between time, pixels, seconds and frames', () => {
      near(msToPx(1500, 40), 60)
      near(pxToMs(60, 40), 1500)
      assert.equal(pxToMs(10, 0), 0)
      near(frameToSeconds(48, 24), 2)
      assert.equal(frameToSeconds(10, 0), 0)
      assert.equal(secondsToFrame(1.5, 24), 36)
      assert.equal(secondsToFrame(2, 0), 0)
      assert.equal(msToFrame(1000, 24), 24)
      assert.equal(msToFrame(20, 24), 0)
      assert.equal(msToFrame(1000, 0), 0)
      near(frameToMs(12, 24), 500)
      assert.equal(frameToMs(5, -1), 0)
      assert.equal(pxToFrame(40, 50, 24), 24)
      assert.equal(pxToFrame(0, 50, 24), 0)
    })
  })
})
