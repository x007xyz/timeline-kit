import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cloneDocument, demoDocument, shareStructure } from '../src/model'
import { CommandBus, TimelineStore, registerBuiltinCommands } from '../src/store'

function createBus(maxHistory?: number) {
  const store = new TimelineStore({ document: demoDocument, historyMode: 'internal', maxHistory })
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
  return { store, bus }
}

describe('history structural sharing', () => {
  it('returns prev unchanged when next is a structurally equal copy', () => {
    const prev = cloneDocument(demoDocument)
    assert.equal(shareStructure(prev, cloneDocument(prev)), prev)
    assert.equal(shareStructure(null, prev), prev)
  })

  it('reuses untouched tracks and clips and replaces only the changed ones', () => {
    const prev = cloneDocument(demoDocument)
    const next = cloneDocument(prev)
    const target = next.tracks[0]!
    target.clips[0] = { ...target.clips[0]!, name: 'renamed' }

    const shared = shareStructure(prev, next)
    assert.notEqual(shared, prev)
    assert.notEqual(shared.tracks[0], prev.tracks[0])
    assert.equal(shared.tracks[0]!.clips[0]!.name, 'renamed')
    for (let i = 1; i < prev.tracks[0]!.clips.length; i += 1) {
      assert.equal(shared.tracks[0]!.clips[i], prev.tracks[0]!.clips[i])
    }
    for (let i = 1; i < prev.tracks.length; i += 1) {
      assert.equal(shared.tracks[i], prev.tracks[i])
    }
    assert.deepEqual(shared, next)
  })

  it('detects changes in nested meta, track flags, and track order', () => {
    const prev = cloneDocument(demoDocument)

    const metaChange = cloneDocument(prev)
    metaChange.tracks[1]!.clips[0]!.meta = { ...(metaChange.tracks[1]!.clips[0]!.meta ?? {}), extra: { deep: [1, 2] } }
    assert.notEqual(shareStructure(prev, metaChange).tracks[1], prev.tracks[1])

    const flagChange = cloneDocument(prev)
    flagChange.tracks[0]!.locked = !flagChange.tracks[0]!.locked
    const flagged = shareStructure(prev, flagChange)
    assert.notEqual(flagged.tracks[0], prev.tracks[0])
    assert.equal(flagged.tracks[0]!.clips[0], prev.tracks[0]!.clips[0])

    const reordered = cloneDocument(prev)
    reordered.tracks.reverse()
    const shuffled = shareStructure(prev, reordered)
    assert.notEqual(shuffled, prev)
    assert.equal(shuffled.tracks[0], prev.tracks[prev.tracks.length - 1])
  })

  it('undo/redo restore the exact prior document objects without re-cloning', () => {
    const { store, bus } = createBus()
    const before = store.getState().document

    bus.execute('selection:set', { clipId: 'clip-v1-open' })
    assert.equal(bus.execute('delete'), true)
    const after = store.getState().document
    assert.notEqual(after, before)

    // Tracks not touched by the delete are shared between the two versions.
    const untouched = before.tracks.filter(track => !track.clips.some(clip => clip.id === 'clip-v1-open'))
    assert.ok(untouched.length > 0)
    for (const track of untouched) {
      assert.ok(after.tracks.includes(track), `track ${track.id} should be shared`)
    }

    assert.equal(bus.execute('undo'), true)
    assert.equal(store.getState().document, before)
    assert.equal(bus.execute('redo'), true)
    assert.equal(store.getState().document, after)
  })

  it('caps the undo stack at maxHistory', () => {
    const { bus } = createBus(2)
    for (const trackIndex of [0, 1, 2]) {
      assert.equal(bus.execute('track:toggle-flag', { trackIndex, flag: 'muted' }), true)
    }
    let undos = 0
    while (bus.execute('undo')) {
      undos += 1
    }
    assert.equal(undos, 2)
  })
})
