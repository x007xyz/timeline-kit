import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fromOtioTimeline, isOtioTimeline, toOtioTimeline } from '../src/adapters/otio'
import { demoDocument, type TimelineDocument } from '../src/model'
import type { Clip as OtioClip, Timeline as OtioTimeline, Track as OtioTrack } from '../src/otio-core'

/**
 * Round-trip tolerance: one frame at the document's rate (1000 / fps ms).
 * The adapter stores times as integer frames, so each value can drift by up to
 * half a frame per conversion; a single round trip stays well inside one frame.
 */
function frameMs(fps: number): number {
  return 1000 / fps
}

function buildFractionalDoc(fps: number): TimelineDocument {
  const clips = Array.from({ length: 5 }, (_, i) => {
    const startMs = 1234 + i * 3111
    const durationMs = 1000 + i * 137
    return {
      id: `frac-${i}`,
      type: 'video',
      name: `Frac ${i}`,
      resource: `file:///frac-${i}.mov`,
      startMs,
      endMs: startMs + durationMs,
      durationMs: 9000,
      trim: { startMs: 700 + i * 50, endMs: 700 + i * 50 + durationMs },
    }
  })
  return {
    id: `frac-${fps}`,
    name: `Fractional ${fps}`,
    fps,
    tracks: [{ id: 'v1', type: 'video', name: 'V1', clips }],
  }
}

function buildLongDoc(fps: number, count: number): TimelineDocument {
  const clips = Array.from({ length: count }, (_, i) => {
    const startMs = i * 1500 + 500
    return {
      id: `long-${i}`,
      type: 'video',
      name: `Long ${i}`,
      resource: `file:///long-${i}.mov`,
      startMs,
      endMs: startMs + 1000,
    }
  })
  return { id: 'long', name: 'Long', fps, tracks: [{ id: 'v1', type: 'video', name: 'V1', clips }] }
}

function otioTrackWith(children: unknown[], metadata?: OtioTrack['metadata']): OtioTimeline {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 'tl',
    name: 'TL',
    global_start_time: { value: 0, rate: 24 },
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      children: [{
        OTIO_SCHEMA: 'Track.1',
        id: 't1',
        name: 'T1',
        kind: 'Video',
        metadata,
        children: children as OtioTrack['children'],
      }],
    },
  }
}

describe('adapters/otio edge cases', () => {
  describe('non-integer frame rates', () => {
    for (const fps of [29.97, 23.976, 59.94]) {
      it(`round-trips a single ${fps} fps clip within one frame (${frameMs(fps).toFixed(3)} ms) for start, end and trim`, () => {
        const doc = buildFractionalDoc(fps)
        doc.tracks[0].clips = doc.tracks[0].clips.slice(0, 1)
        const back = fromOtioTimeline(toOtioTimeline(doc))
        const tolerance = frameMs(fps)
        const clip = doc.tracks[0].clips[0]
        const actual = back.tracks[0].clips[0]

        assert.equal(back.fps, fps)
        assert.equal(actual.id, clip.id)
        assert.ok(Math.abs(actual.startMs - clip.startMs) <= tolerance, `start ${actual.startMs} vs ${clip.startMs}`)
        assert.ok(Math.abs(actual.endMs - clip.endMs) <= tolerance, `end ${actual.endMs} vs ${clip.endMs}`)
        assert.ok(actual.trim, 'trim should survive the round trip')
        assert.ok(Math.abs(actual.trim!.startMs - clip.trim!.startMs) <= tolerance, 'trim.startMs')
        assert.ok(Math.abs(actual.trim!.endMs - clip.trim!.endMs) <= tolerance, 'trim.endMs')
      })

      it(`keeps a 5-clip ${fps} fps track within one frame (${frameMs(fps).toFixed(3)} ms) [regression]`, () => {
        const doc = buildFractionalDoc(fps)
        const back = fromOtioTimeline(toOtioTimeline(doc))
        const tolerance = frameMs(fps)
        doc.tracks[0].clips.forEach((clip, index) => {
          const actual = back.tracks[0].clips[index]
          assert.ok(Math.abs(actual.startMs - clip.startMs) <= tolerance, `start ${actual.startMs} vs ${clip.startMs}`)
          assert.ok(Math.abs(actual.endMs - clip.endMs) <= tolerance, `end ${actual.endMs} vs ${clip.endMs}`)
        })
      })
    }

    it('keeps a short 59.94 fps track within one frame over several clips', () => {
      const doc = buildLongDoc(59.94, 5)
      const back = fromOtioTimeline(toOtioTimeline(doc))
      const tolerance = frameMs(59.94)
      doc.tracks[0].clips.forEach((clip, index) => {
        const actual = back.tracks[0].clips[index]
        assert.ok(Math.abs(actual.startMs - clip.startMs) <= tolerance)
        assert.ok(Math.abs(actual.endMs - clip.endMs) <= tolerance)
      })
    })

    it('accumulated rounding drifts beyond one frame on long non-integer-rate tracks [regression]', () => {
      const doc = buildLongDoc(59.94, 40)
      const back = fromOtioTimeline(toOtioTimeline(doc))
      const tolerance = frameMs(59.94)
      const last = doc.tracks[0].clips.length - 1
      assert.ok(Math.abs(back.tracks[0].clips[last].startMs - doc.tracks[0].clips[last].startMs) <= tolerance)
    })
  })

  describe('frame quantization without timelineKit metadata', () => {
    // Strips the exact-ms hints so only the frame-quantized OTIO positions are used,
    // as when the file comes back from another OTIO tool.
    function stripExactBounds(otio: ReturnType<typeof toOtioTimeline>) {
      for (const track of otio.tracks.children) {
        for (const item of track.children) {
          const tk = (item.metadata as { timelineKit?: Record<string, unknown> } | undefined)?.timelineKit
          if (tk) {
            delete tk.startMs
            delete tk.endMs
          }
        }
      }
      return otio
    }

    for (const fps of [23.976, 29.97, 59.94]) {
      it(`keeps every clip of a 40-clip ${fps} fps track within half a frame`, () => {
        const doc = buildLongDoc(fps, 40)
        const back = fromOtioTimeline(stripExactBounds(toOtioTimeline(doc)))
        const half = frameMs(fps) / 2 + 1 // +1 ms for the final Math.round to integer ms
        doc.tracks[0].clips.forEach((clip, index) => {
          const got = back.tracks[0].clips[index]
          assert.ok(Math.abs(got.startMs - clip.startMs) <= half, `clip ${index} start drifted ${got.startMs - clip.startMs} ms`)
          assert.ok(Math.abs(got.endMs - clip.endMs) <= half, `clip ${index} end drifted ${got.endMs - clip.endMs} ms`)
        })
      })
    }

    it('round-trips exactly (integer ms) when the timelineKit bounds are present', () => {
      const doc = buildLongDoc(29.97, 40)
      const back = fromOtioTimeline(toOtioTimeline(doc))
      assert.deepEqual(
        back.tracks[0].clips.map(c => [c.startMs, c.endMs]),
        doc.tracks[0].clips.map(c => [c.startMs, c.endMs]),
      )
    })

    it('prefers the OTIO position when the file was re-timed elsewhere', () => {
      const doc = buildLongDoc(25, 3)
      const otio = toOtioTimeline(doc)
      const firstItem = otio.tracks.children[0].children[0]
      firstItem.source_range!.duration.value += 25 // leading gap one second longer
      const back = fromOtioTimeline(otio)
      const lastOrig = doc.tracks[0].clips[2]
      // Everything after the edit shifts by one second; stale exact bounds are ignored.
      assert.ok(Math.abs(back.tracks[0].clips[2].startMs - (lastOrig.startMs + 1000)) <= 40)
    })
  })

  describe('frame rate fallback', () => {
    for (const fps of [0, -5]) {
      it(`exports a non-positive fps (${fps}) as 24 fps and reads it back as 24`, () => {
        const doc: TimelineDocument = {
          id: 'bad-fps',
          name: 'Bad FPS',
          fps,
          tracks: [{
            id: 't1',
            type: 'video',
            name: 'V1',
            clips: [{ id: 'c1', type: 'video', name: 'c1', resource: 'a.mov', startMs: 0, endMs: 1000 }],
          }],
        }
        const otio = toOtioTimeline(doc)
        assert.deepEqual(otio.global_start_time, { value: 0, rate: 24 })
        const clip = otio.tracks.children[0].children[0] as OtioClip
        assert.equal(clip.source_range!.duration.value, 24)
        assert.equal(clip.source_range!.duration.rate, 24)

        const back = fromOtioTimeline(otio)
        assert.equal(back.fps, 24)
        assert.equal(back.tracks[0].clips[0].endMs, 1000)
      })
    }

    it('falls back to 24 fps on import when global_start_time has a zero rate', () => {
      const otio = otioTrackWith([])
      otio.global_start_time = { value: 0, rate: 0 }
      assert.equal(fromOtioTimeline(otio).fps, 24)
    })
  })

  describe('missing and malformed fields', () => {
    it('infers clip and track type from the track kind when clip and track metadata are absent', () => {
      const otio = otioTrackWith([
        {
          OTIO_SCHEMA: 'Clip.1',
          id: 'c1',
          name: 'bare',
          source_range: { start_time: { value: 0, rate: 24 }, duration: { value: 24, rate: 24 } },
          media_reference: { OTIO_SCHEMA: 'ExternalReference.1', target_url: 'x.mov' },
        },
      ])
      const audioOtio = otioTrackWith([])
      audioOtio.tracks.children[0].kind = 'Audio'

      const doc = fromOtioTimeline(otio)
      assert.equal(doc.tracks[0].type, 'video')
      assert.equal(doc.tracks[0].clips[0].type, 'video')
      assert.equal(doc.tracks[0].clips[0].resource, 'x.mov')
      assert.equal(doc.tracks[0].clips[0].endMs, 1000)
      assert.equal(doc.tracks[0].locked, undefined)
      assert.equal(doc.tracks[0].main, undefined)
      assert.equal(fromOtioTimeline(audioOtio).tracks[0].type, 'audio')
    })

    it('leaves resource undefined when an external reference has no target_url', () => {
      const otio = otioTrackWith([
        {
          OTIO_SCHEMA: 'Clip.1',
          id: 'c1',
          name: 'nourl',
          source_range: { start_time: { value: 0, rate: 24 }, duration: { value: 24, rate: 24 } },
          media_reference: { OTIO_SCHEMA: 'ExternalReference.1' } as OtioClip['media_reference'],
        },
      ])
      assert.equal(fromOtioTimeline(otio).tracks[0].clips[0].resource, undefined)
    })

    it('uses defaults for a timeline without id or name', () => {
      const otio = otioTrackWith([])
      otio.id = ''
      otio.name = ''
      const doc = fromOtioTimeline(otio)
      assert.equal(doc.id, 'timeline-kit')
      assert.equal(doc.name, 'Timeline')
    })

    it('a Clip.1 without source_range makes fromOtioTimeline throw [regression]', () => {
      const otio = otioTrackWith([
        {
          OTIO_SCHEMA: 'Clip.1',
          id: 'nosrc',
          name: 'nosrc',
          media_reference: { OTIO_SCHEMA: 'ExternalReference.1', target_url: 'x.mov' },
        },
      ])
      const doc = fromOtioTimeline(otio)
      assert.equal(doc.tracks[0].clips[0].startMs, 0)
      assert.equal(doc.tracks[0].clips[0].endMs, 0)
    })
  })

  describe('Gap items', () => {
    it('advances the timeline cursor across leading and interior gaps but not for trailing gaps', () => {
      const gap = (ms: number, id: string): OtioTrack['children'][number] => ({
        OTIO_SCHEMA: 'Gap.1',
        id,
        name: id,
        source_range: { start_time: { value: 0, rate: 1000 }, duration: { value: ms, rate: 1000 } },
      })
      const clip = (id: string, ms: number): OtioTrack['children'][number] => ({
        OTIO_SCHEMA: 'Clip.1',
        id,
        name: id,
        source_range: { start_time: { value: 0, rate: 1000 }, duration: { value: ms, rate: 1000 } },
        media_reference: { OTIO_SCHEMA: 'ExternalReference.1', target_url: `${id}.mov` },
      })
      const doc = fromOtioTimeline(otioTrackWith([
        gap(1000, 'lead'),
        clip('c1', 2000),
        gap(500, 'mid'),
        clip('c2', 1000),
        gap(3000, 'trail'),
      ]))
      const clips = doc.tracks[0].clips.map(c => [c.id, c.startMs, c.endMs])
      assert.deepEqual(clips, [['c1', 1000, 3000], ['c2', 3500, 4500]])
    })

    it('exports Gap.1 items only where a clip does not start at the previous clip end', () => {
      const doc: TimelineDocument = {
        id: 'gaps',
        name: 'Gaps',
        fps: 24,
        tracks: [{
          id: 't1',
          type: 'video',
          name: 'V1',
          clips: [
            { id: 'b', type: 'video', name: 'B', resource: 'b.mov', startMs: 2000, endMs: 3000 },
            { id: 'a', type: 'video', name: 'A', resource: 'a.mov', startMs: 0, endMs: 1000 },
            { id: 'c', type: 'video', name: 'C', resource: 'c.mov', startMs: 3000, endMs: 4000 },
          ],
        }],
      }
      const children = toOtioTimeline(doc).tracks.children[0].children
      assert.deepEqual(children.map(c => c.OTIO_SCHEMA), ['Clip.1', 'Gap.1', 'Clip.1', 'Clip.1'])
      assert.equal(children[1].id, 't1:b:gap')
      const back = fromOtioTimeline(toOtioTimeline(doc))
      assert.deepEqual(back.tracks[0].clips.map(c => [c.id, c.startMs, c.endMs]), [
        ['a', 0, 1000],
        ['b', 2000, 3000],
        ['c', 3000, 4000],
      ])
    })
  })

  describe('empty tracks and documents', () => {
    it('round-trips a track with no clips and a document with no tracks', () => {
      const doc: TimelineDocument = {
        id: 'empty',
        name: 'Empty',
        fps: 25,
        tracks: [{ id: 't1', type: 'audio', name: 'A1', clips: [] }],
      }
      const otio = toOtioTimeline(doc)
      assert.equal(otio.tracks.children[0].children.length, 0)
      assert.equal(otio.tracks.children[0].kind, 'Audio')
      const back = fromOtioTimeline(otio)
      assert.equal(back.tracks.length, 1)
      assert.deepEqual(back.tracks[0].clips, [])
      assert.equal(back.tracks[0].type, 'audio')

      const none = fromOtioTimeline(toOtioTimeline({ id: 'none', name: 'None', fps: 25, tracks: [] }))
      assert.deepEqual(none.tracks, [])
      assert.equal(none.fps, 25)
    })
  })

  describe('metadata preservation', () => {
    it('preserves document meta, track flags, track meta and clip meta across a round trip', () => {
      const doc: TimelineDocument = {
        id: 'meta',
        name: 'Meta',
        fps: 24,
        meta: { project: 'demo', version: 3 },
        tracks: [{
          id: 'v1',
          type: 'video',
          name: 'V1',
          locked: true,
          visible: false,
          muted: true,
          main: true,
          meta: { color: 'red' },
          clips: [{
            id: 'c1',
            type: 'video',
            name: 'C1',
            resource: 'c1.mov',
            startMs: 0,
            endMs: 2000,
            durationMs: 6000,
            trim: { startMs: 1000, endMs: 3000 },
            meta: { takeNumber: 4 },
          }],
        }],
      }
      const back = fromOtioTimeline(toOtioTimeline(doc))
      assert.deepEqual(back.meta, { project: 'demo', version: 3 })
      const track = back.tracks[0]
      assert.equal(track.locked, true)
      assert.equal(track.visible, false)
      assert.equal(track.muted, true)
      assert.equal(track.main, true)
      assert.deepEqual(track.meta, { color: 'red' })
      const clip = track.clips[0]
      assert.equal(clip.durationMs, 6000)
      assert.deepEqual(clip.trim, { startMs: 1000, endMs: 3000 })
      assert.deepEqual(clip.meta, { takeNumber: 4 })
    })

    it('keeps foreign OTIO metadata keys on tracks and clips as custom meta', () => {
      const otio = otioTrackWith([
        {
          OTIO_SCHEMA: 'Clip.1',
          id: 'c1',
          name: 'vendor',
          source_range: { start_time: { value: 0, rate: 24 }, duration: { value: 24, rate: 24 } },
          media_reference: { OTIO_SCHEMA: 'ExternalReference.1', target_url: 'v.mov' },
          metadata: { vendorX: { rating: 5 }, timelineKit: { type: 'video' } },
        },
      ], { vendorTrack: 'keep-me' })
      const doc = fromOtioTimeline(otio)
      assert.deepEqual(doc.tracks[0].meta, { vendorTrack: 'keep-me' })
      assert.deepEqual(doc.tracks[0].clips[0].meta, { vendorX: { rating: 5 } })
    })

    it('preserves generator (text) content and parameters, and keeps trim undefined for text clips', () => {
      const doc: TimelineDocument = {
        id: 'text',
        name: 'Text',
        fps: 24,
        tracks: [{
          id: 't1',
          type: 'text',
          name: 'T1',
          clips: [{
            id: 'txt',
            type: 'text',
            name: 'Title',
            resource: 'Hello',
            startMs: 0,
            endMs: 2000,
            meta: { fontSize: 42 },
          }],
        }],
      }
      const otio = toOtioTimeline(doc)
      const media = (otio.tracks.children[0].children[0] as OtioClip).media_reference
      assert.equal(media.OTIO_SCHEMA, 'GeneratorReference.1')

      const back = fromOtioTimeline(otio)
      const clip = back.tracks[0].clips[0]
      assert.equal(clip.resource, 'Hello')
      assert.equal(clip.trim, undefined)
      assert.deepEqual(clip.meta, { fontSize: 42 })
    })

    it('a video clip with no trim gains a synthesized trim on import [regression]', () => {
      const doc: TimelineDocument = {
        id: 'notrim',
        name: 'NoTrim',
        fps: 24,
        tracks: [{
          id: 'v1',
          type: 'video',
          name: 'V1',
          clips: [{ id: 'a', type: 'video', name: 'A', resource: 'a.mov', startMs: 0, endMs: 1000 }],
        }],
      }
      const back = fromOtioTimeline(toOtioTimeline(doc))
      assert.equal(back.tracks[0].clips[0].trim, undefined)
    })
  })

  describe('isOtioTimeline', () => {
    it('rejects non-OTIO and structurally incomplete values', () => {
      assert.equal(isOtioTimeline(null), false)
      assert.equal(isOtioTimeline(undefined), false)
      assert.equal(isOtioTimeline('Timeline.1'), false)
      assert.equal(isOtioTimeline([]), false)
      assert.equal(isOtioTimeline(demoDocument), false)
      assert.equal(isOtioTimeline({ OTIO_SCHEMA: 'Clip.1', tracks: { children: [] } }), false)
      assert.equal(isOtioTimeline({ OTIO_SCHEMA: 'Timeline.1' }), false)
      assert.equal(isOtioTimeline({ OTIO_SCHEMA: 'Timeline.1', tracks: {} }), false)
      assert.equal(isOtioTimeline({ OTIO_SCHEMA: 'Timeline.1', tracks: { children: 'nope' } }), false)
    })

    it('accepts a minimal Timeline.1 with a Stack of tracks', () => {
      assert.equal(isOtioTimeline({ OTIO_SCHEMA: 'Timeline.1', tracks: { children: [] } }), true)
      assert.equal(isOtioTimeline(toOtioTimeline(demoDocument)), true)
    })
  })
})
