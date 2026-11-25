import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fromOtioTimeline, isOtioTimeline, otioDemoTimeline, toOtioTimeline } from '../src/adapters/otio'
import { demoDocument } from '../src/model'
import type { Timeline as OtioTimeline } from '../src/otio-core'

describe('adapters/otio', () => {
  it('recognizes OTIO Timeline.1 payloads and round-trips TimelineDocument faithfully', () => {
    assert.equal(isOtioTimeline(demoDocument), false)
    assert.equal(isOtioTimeline(otioDemoTimeline), true)

    const otio = toOtioTimeline(demoDocument)
    assert.equal(otio.OTIO_SCHEMA, 'Timeline.1')
    assert.equal(otio.tracks.children.length, demoDocument.tracks.length)

    // First track has opening gap 0..5000ms before text clip at 5000..10000ms
    const textTrack = otio.tracks.children[0]
    assert.equal(textTrack.children[0].OTIO_SCHEMA, 'Gap.1')
    assert.equal(textTrack.children[1].OTIO_SCHEMA, 'Clip.1')

    const roundTripped = fromOtioTimeline(otio)
    assert.equal(roundTripped.fps, demoDocument.fps)
    assert.equal(roundTripped.tracks.length, demoDocument.tracks.length)
    assert.equal(roundTripped.tracks[0].clips[0].startMs, 5000)
    assert.equal(roundTripped.tracks[0].clips[0].endMs, 10000)
    assert.equal(roundTripped.tracks[0].clips[0].resource, 'The End')
    assert.equal(roundTripped.tracks[1].main, true)
    assert.deepEqual(roundTripped.tracks[1].clips[0].trim, { startMs: 2000, endMs: 6000 })
    assert.equal(roundTripped.tracks[1].clips[0].durationMs, 10000)
  })

  it('imports legacy flyCut OTIO metadata cleanly without requiring timelineKit metadata', () => {
    const legacyOtio: OtioTimeline = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'legacy-otio',
      name: 'Legacy OTIO',
      global_start_time: { value: 0, rate: 24 },
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        children: [
          {
            OTIO_SCHEMA: 'Track.1',
            id: 'legacy-t1',
            name: 'V1',
            kind: 'Video',
            metadata: {
              flyCut: {
                type: 'video',
                main: true,
                lock: true,
                visible: true,
              },
            },
            children: [
              {
                OTIO_SCHEMA: 'Gap.1',
                id: 'g1',
                name: 'Gap',
                source_range: {
                  start_time: { value: 0, rate: 24 },
                  duration: { value: 24, rate: 24 },
                },
              },
              {
                OTIO_SCHEMA: 'Clip.1',
                id: 'c1',
                name: 'Legacy Clip',
                source_range: {
                  start_time: { value: 48, rate: 24 },
                  duration: { value: 72, rate: 24 },
                },
                media_reference: {
                  OTIO_SCHEMA: 'ExternalReference.1',
                  target_url: 'https://example.com/video.mp4',
                },
                metadata: {
                  flyCut: {
                    type: 'video',
                    resourceInfo: { duration: 9000 },
                  },
                },
              },
            ],
          },
        ],
      },
    }

    const doc = fromOtioTimeline(legacyOtio)
    assert.equal(doc.fps, 24)
    assert.equal(doc.tracks[0].locked, true)
    assert.equal(doc.tracks[0].main, true)
    assert.equal(doc.tracks[0].clips[0].startMs, 1000)
    assert.equal(doc.tracks[0].clips[0].endMs, 4000)
    assert.equal(doc.tracks[0].clips[0].durationMs, 9000)
    assert.deepEqual(doc.tracks[0].clips[0].trim, { startMs: 2000, endMs: 5000 })
  })
})
