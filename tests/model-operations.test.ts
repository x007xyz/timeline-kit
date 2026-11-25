import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_EDIT_POLICIES,
  applyMagnetMove,
  cleanupTracks,
  deleteClips,
  insertClip,
  moveClip,
  splitClipAtMs,
  toggleTrackFlag,
  trimClip,
  type TimelineDocument,
} from '../src/model'

function createSampleDoc(): TimelineDocument {
  return {
    id: 'doc-1',
    name: 'Test Doc',
    fps: 25,
    tracks: [
      {
        id: 't-video-1',
        type: 'video',
        name: 'V1',
        main: true,
        clips: [
          {
            id: 'v1',
            type: 'video',
            name: 'Clip 1',
            startMs: 0,
            endMs: 4000,
            durationMs: 10000,
            trim: { startMs: 1000, endMs: 5000 },
          },
          {
            id: 'v2',
            type: 'video',
            name: 'Clip 2',
            startMs: 5000,
            endMs: 8000,
            durationMs: 8000,
            trim: { startMs: 0, endMs: 3000 },
          },
        ],
      },
      {
        id: 't-text-1',
        type: 'text',
        name: 'T1',
        clips: [
          {
            id: 'txt1',
            type: 'text',
            name: 'Title',
            startMs: 1000,
            endMs: 3000,
            resource: 'Hello',
          },
        ],
      },
      {
        id: 't-audio-1',
        type: 'audio',
        name: 'A1',
        clips: [
          {
            id: 'a1',
            type: 'audio',
            name: 'BGM',
            startMs: 0,
            endMs: 9000,
            durationMs: 12000,
            trim: { startMs: 0, endMs: 9000 },
          },
        ],
      },
    ],
  }
}

describe('model/operations', () => {
  it('moves clips within track, rejects overlap by default, and supports allowOverlap policy', () => {
    const doc = createSampleDoc()

    const validMove = moveClip(doc, {
      sourceTrackIndex: 0,
      sourceClipIndex: 0,
      targetTrackIndex: 0,
      isNewTrack: false,
      startMs: 500,
      endMs: 4500,
    })
    assert.equal(validMove.changed, true)
    assert.equal(validMove.document.tracks[0].clips[0].startMs, 500)
    assert.equal(validMove.document.tracks[0].clips[0].endMs, 4500)
    assert.equal(doc.tracks[0].clips[0].startMs, 0) // immutable

    const overlapBlocked = moveClip(doc, {
      sourceTrackIndex: 0,
      sourceClipIndex: 0,
      targetTrackIndex: 0,
      isNewTrack: false,
      startMs: 4000,
      endMs: 8000,
    })
    assert.equal(overlapBlocked.changed, false)

    const overlapAllowed = moveClip(
      doc,
      {
        sourceTrackIndex: 0,
        sourceClipIndex: 0,
        targetTrackIndex: 0,
        isNewTrack: false,
        startMs: 4000,
        endMs: 8000,
      },
      { ...DEFAULT_EDIT_POLICIES, allowOverlap: true },
    )
    assert.equal(overlapAllowed.changed, true)
    assert.equal(overlapAllowed.document.tracks[0].clips[0].startMs, 4000)
  })

  it('creates a new track on move, removes empty source track, and keeps audio tracks at bottom', () => {
    const doc = createSampleDoc()
    const moved = moveClip(doc, {
      sourceTrackIndex: 1,
      sourceClipIndex: 0,
      targetTrackIndex: 3, // below audio track
      isNewTrack: true,
      startMs: 2000,
      endMs: 4000,
      clipType: 'text',
    })
    assert.equal(moved.changed, true)
    // Old empty text track removed, new text track placed before audio track due to orderAudioToBottom
    const types = moved.document.tracks.map(t => t.type)
    assert.equal(types[types.length - 1], 'audio')
    assert.equal(moved.selection.clipId, 'txt1')
    assert.equal(moved.document.tracks[moved.selection.trackIndex].clips[moved.selection.clipIndex].startMs, 2000)
  })

  it('respects custom canDrop policy and locked tracks', () => {
    const doc = createSampleDoc()
    const lockedDoc = toggleTrackFlag(doc, 0, 'locked').document
    const blockedByLock = moveClip(lockedDoc, {
      sourceTrackIndex: 0,
      sourceClipIndex: 0,
      targetTrackIndex: 0,
      isNewTrack: false,
      startMs: 200,
      endMs: 4200,
    })
    assert.equal(blockedByLock.changed, false)

    const blockedByPolicy = moveClip(
      doc,
      {
        sourceTrackIndex: 0,
        sourceClipIndex: 0,
        targetTrackIndex: 0,
        isNewTrack: false,
        startMs: 200,
        endMs: 4200,
      },
      {
        ...DEFAULT_EDIT_POLICIES,
        canDrop: ({ startMs }) => startMs >= 300,
      },
    )
    assert.equal(blockedByPolicy.changed, false)
  })

  it('trims start and end edges respecting media durationMs, trim bounds, and neighbor boundaries', () => {
    const doc = createSampleDoc()

    // Start trim left: v1 starts at 0ms, trim.startMs = 1000ms, clamped by timeline start 0
    const moved = moveClip(doc, {
      sourceTrackIndex: 0,
      sourceClipIndex: 0,
      targetTrackIndex: 0,
      isNewTrack: false,
      startMs: 1000,
      endMs: 5000,
    }).document
    // Move v2 to 6000..9000 first so we have room
    const roomDoc = moveClip(moved, {
      sourceTrackIndex: 0,
      sourceClipIndex: 1,
      targetTrackIndex: 0,
      isNewTrack: false,
      startMs: 6000,
      endMs: 9000,
    }).document

    const trimStartExtend = trimClip(roomDoc, {
      trackIndex: 0,
      clipIndex: 0,
      offsetMs: -1500, // trim.startMs is 1000, so max left extend is -1000ms -> startMs=0, trim.startMs=0
      edge: 'start',
    })
    assert.equal(trimStartExtend.changed, true)
    assert.equal(trimStartExtend.document.tracks[0].clips[0].startMs, 0)
    assert.deepEqual(trimStartExtend.document.tracks[0].clips[0].trim, { startMs: 0, endMs: 5000 })

    // End trim right: neighbor v2 starts at 6000ms, so endMs clamped to 6000 (not 8000)
    const trimEndExtend = trimClip(roomDoc, {
      trackIndex: 0,
      clipIndex: 0,
      offsetMs: 3000,
      edge: 'end',
    })
    assert.equal(trimEndExtend.changed, true)
    assert.equal(trimEndExtend.document.tracks[0].clips[0].endMs, 6000)
    assert.deepEqual(trimEndExtend.document.tracks[0].clips[0].trim, { startMs: 1000, endMs: 6000 })

    // Text clip (non-media) can extend end freely
    const trimText = trimClip(doc, {
      trackIndex: 1,
      clipIndex: 0,
      offsetMs: 2500,
      edge: 'end',
    })
    assert.equal(trimText.changed, true)
    assert.equal(trimText.document.tracks[1].clips[0].endMs, 5500)
    assert.equal(trimText.document.tracks[1].clips[0].trim, undefined)
  })

  it('splits clip with continuous trim offsets and unique right clip id', () => {
    const doc = createSampleDoc()
    const split = splitClipAtMs(doc, {
      trackIndex: 0,
      clipIndex: 0,
      splitMs: 1500,
    })
    assert.equal(split.changed, true)
    assert.equal(split.leftClipId, 'v1')
    assert.ok(split.rightClipId && split.rightClipId !== 'v1')

    const clips = split.document.tracks[0].clips
    assert.equal(clips.length, 3)
    assert.equal(clips[0].startMs, 0)
    assert.equal(clips[0].endMs, 1500)
    assert.deepEqual(clips[0].trim, { startMs: 1000, endMs: 2500 })
    assert.equal(clips[1].id, split.rightClipId)
    assert.equal(clips[1].startMs, 1500)
    assert.equal(clips[1].endMs, 4000)
    assert.deepEqual(clips[1].trim, { startMs: 2500, endMs: 5000 })
  })

  it('deletes clips with magnet packing and protects locked tracks', () => {
    const doc = createSampleDoc()
    const deletedMagnet = deleteClips(doc, ['v1'], DEFAULT_EDIT_POLICIES, true)
    assert.equal(deletedMagnet.changed, true)
    // v2 was at 5000..8000 on main track -> packed to 0..3000 when magnet enabled
    assert.equal(deletedMagnet.document.tracks[0].clips.length, 1)
    assert.equal(deletedMagnet.document.tracks[0].clips[0].startMs, 0)
    assert.equal(deletedMagnet.document.tracks[0].clips[0].endMs, 3000)

    const lockedDoc = toggleTrackFlag(doc, 0, 'locked').document
    const blockedDelete = deleteClips(lockedDoc, ['v1'], DEFAULT_EDIT_POLICIES, false)
    assert.equal(blockedDelete.changed, false)
  })

  it('inserts new clips and commits magnet rearrangement', () => {
    const doc = createSampleDoc()
    const inserted = insertClip(doc, {
      trackIndex: 1,
      isNewTrack: false,
      clip: {
        id: 'txt-new',
        type: 'text',
        name: 'Inserted',
        startMs: 3500,
        endMs: 5000,
        resource: 'New Title',
      },
    })
    assert.equal(inserted.changed, true)
    assert.equal(inserted.document.tracks[1].clips.length, 2)
    assert.equal(inserted.selection.clipId, 'txt-new')

    // Cleanup with magnet enabled packs v1 (4000ms) + v2 (3000ms) seamlessly
    const packed = cleanupTracks(doc, DEFAULT_EDIT_POLICIES, true)
    assert.equal(packed.changed, true)
    assert.equal(packed.document.tracks[0].clips[1].startMs, 4000)
    assert.equal(packed.document.tracks[0].clips[1].endMs, 7000)

    const magnetMoved = applyMagnetMove(packed.document, {
      sourceTrackIndex: 0,
      sourceClipIndex: 1,
      targetTrackIndex: 0,
      insertPosition: 0,
      previewArrangement: [{ ...packed.document.tracks[0].clips[0], startMs: 3000, endMs: 7000 }],
      dragClipDurationMs: 3000,
    })
    assert.equal(magnetMoved.changed, true)
    assert.equal(magnetMoved.document.tracks[0].clips[0].id, 'v2')
    assert.equal(magnetMoved.document.tracks[0].clips[0].startMs, 0)
    assert.equal(magnetMoved.document.tracks[0].clips[1].id, 'v1')
    assert.equal(magnetMoved.document.tracks[0].clips[1].startMs, 3000)
  })
})
