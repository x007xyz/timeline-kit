import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getTrimOffset } from '../src/utils/trimOffset'

function near(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  )
}

const NEUTRAL = { offsetPercent: 0, scalePercent: 100 }

describe('utils/trimOffset getTrimOffset', () => {
  describe('TimelineClip shape (trim + durationMs)', () => {
    it('uses durationMs as the source length when it is positive', () => {
      const result = getTrimOffset({
        startMs: 0,
        endMs: 4000,
        durationMs: 10000,
        trim: { startMs: 2000, endMs: 6000 },
      })
      near(result.offsetPercent, 20)
      near(result.scalePercent, 40)
    })

    it('falls back to the timeline span (endMs - startMs) when durationMs is missing or zero', () => {
      const missing = getTrimOffset({ startMs: 1000, endMs: 9000, trim: { startMs: 1000, endMs: 5000 } })
      near(missing.offsetPercent, 12.5) // 1000 / 8000
      near(missing.scalePercent, 50) // 4000 / 8000

      const zero = getTrimOffset({ startMs: 0, endMs: 8000, durationMs: 0, trim: { startMs: 2000, endMs: 4000 } })
      near(zero.offsetPercent, 25)
      near(zero.scalePercent, 25)
    })

    it('returns the neutral result when both durationMs and the timeline span are non-positive', () => {
      const result = getTrimOffset({ startMs: 5000, endMs: 5000, trim: { startMs: 0, endMs: 100 } })
      assert.deepEqual(result, NEUTRAL)
    })

    it('ignores a trim whose bounds are not numbers and falls through to the neutral result', () => {
      const result = getTrimOffset({ durationMs: 1000, trim: { startMs: '0', endMs: 500 } })
      assert.deepEqual(result, NEUTRAL)
    })
  })

  describe('legacy shape (trimInfo + resourceInfo)', () => {
    it('computes offset and scale from trimInfo over resourceInfo.duration', () => {
      const result = getTrimOffset({
        start: 0,
        end: 2000,
        trimInfo: { startMs: 1000, endMs: 3000 },
        resourceInfo: { duration: 10000 },
      })
      near(result.offsetPercent, 10)
      near(result.scalePercent, 20)
    })

    it('falls back to clip.end - clip.start when resourceInfo.duration is zero', () => {
      const result = getTrimOffset({
        start: 0,
        end: 5000,
        trimInfo: { startMs: 1000, endMs: 3000 },
        resourceInfo: { duration: 0 },
      })
      near(result.offsetPercent, 20) // 1000 / 5000
      near(result.scalePercent, 40) // 2000 / 5000
    })

    it('returns the neutral result when both legacy durations are non-positive', () => {
      const result = getTrimOffset({
        start: 3000,
        end: 3000,
        trimInfo: { startMs: 0, endMs: 100 },
        resourceInfo: { duration: 0 },
      })
      assert.deepEqual(result, NEUTRAL)
    })

    it('returns the neutral result when trimInfo or resourceInfo is absent', () => {
      assert.deepEqual(getTrimOffset({ trimInfo: { startMs: 0, endMs: 1 } }), NEUTRAL)
      assert.deepEqual(getTrimOffset({ resourceInfo: { duration: 1000 } }), NEUTRAL)
    })
  })

  describe('OTIO Clip.1 shape', () => {
    it('uses the external reference available_range as the total duration', () => {
      const result = getTrimOffset({
        OTIO_SCHEMA: 'Clip.1',
        name: 'c',
        source_range: {
          start_time: { value: 48, rate: 24 }, // 2000ms
          duration: { value: 72, rate: 24 }, // 3000ms
        },
        media_reference: {
          OTIO_SCHEMA: 'ExternalReference.1',
          target_url: 'file:///a.mov',
          available_range: {
            start_time: { value: 0, rate: 24 },
            duration: { value: 216, rate: 24 }, // 9000ms
          },
        },
      })
      near(result.offsetPercent, (2000 / 9000) * 100)
      near(result.scalePercent, (3000 / 9000) * 100)
    })

    it('falls back to metadata.timelineKit.durationMs when there is no available_range', () => {
      const result = getTrimOffset({
        OTIO_SCHEMA: 'Clip.1',
        name: 'g',
        source_range: {
          start_time: { value: 0, rate: 1000 },
          duration: { value: 1500, rate: 1000 },
        },
        media_reference: { OTIO_SCHEMA: 'GeneratorReference.1', generator_kind: 'x', parameters: {} },
        metadata: { timelineKit: { durationMs: 6000 } },
      })
      near(result.offsetPercent, 0)
      near(result.scalePercent, 25)
    })

    it('falls back to the trim duration when no total duration source exists', () => {
      const result = getTrimOffset({
        OTIO_SCHEMA: 'Clip.1',
        name: 'bare',
        source_range: {
          start_time: { value: 1, rate: 2 }, // 500ms
          duration: { value: 2, rate: 1 }, // 2000ms
        },
        media_reference: { OTIO_SCHEMA: 'MissingReference.1' },
      })
      near(result.offsetPercent, 25) // 500 / 2000
      near(result.scalePercent, 100)
    })

    it('treats a zero rate time value as 0 ms and yields the neutral result when the total is unknown', () => {
      const result = getTrimOffset({
        OTIO_SCHEMA: 'Clip.1',
        name: 'norate',
        source_range: {
          start_time: { value: 10, rate: 0 },
          duration: { value: 10, rate: 0 },
        },
        media_reference: { OTIO_SCHEMA: 'MissingReference.1' },
      })
      assert.deepEqual(result, NEUTRAL)
    })

    it('returns the neutral result when source_range is absent on a Clip.1', () => {
      const result = getTrimOffset({ OTIO_SCHEMA: 'Clip.1', name: 'nosrc' })
      assert.deepEqual(result, NEUTRAL)
    })

    it('does not treat a Gap.1 item as an OTIO clip', () => {
      const result = getTrimOffset({
        OTIO_SCHEMA: 'Gap.1',
        source_range: { start_time: { value: 0, rate: 24 }, duration: { value: 24, rate: 24 } },
      })
      assert.deepEqual(result, NEUTRAL)
    })
  })

  describe('degenerate inputs', () => {
    it('returns the neutral result for null, undefined, primitives and empty objects', () => {
      assert.deepEqual(getTrimOffset(null), NEUTRAL)
      assert.deepEqual(getTrimOffset(undefined), NEUTRAL)
      assert.deepEqual(getTrimOffset(0), NEUTRAL)
      assert.deepEqual(getTrimOffset('clip'), NEUTRAL)
      assert.deepEqual(getTrimOffset({}), NEUTRAL)
    })
  })
})
