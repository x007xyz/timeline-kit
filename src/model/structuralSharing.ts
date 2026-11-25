import type { TimelineClip, TimelineDocument, TimelineTrack } from './types'

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false
  }
  if (Array.isArray(a)) {
    const other = b as unknown[]
    if (a.length !== other.length) {
      return false
    }
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], other[i])) {
        return false
      }
    }
    return true
  }
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  const keysA = Object.keys(ra).filter(key => ra[key] !== undefined)
  const keysB = Object.keys(rb).filter(key => rb[key] !== undefined)
  if (keysA.length !== keysB.length) {
    return false
  }
  for (const key of keysA) {
    if (!deepEqual(ra[key], rb[key])) {
      return false
    }
  }
  return true
}

/** Shallow-compare every own field except `skip`, deep-comparing the rest. */
function fieldsEqual(a: object, b: object, skip: string): boolean {
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)])
  for (const key of keys) {
    if (key === skip) {
      continue
    }
    if (!deepEqual(ra[key], rb[key])) {
      return false
    }
  }
  return true
}

/**
 * Returns `next`, but with every track and clip that is structurally equal to its
 * counterpart in `prev` replaced by the `prev` object itself. Store documents are
 * treated as immutable, so successive history entries can share unchanged parts
 * instead of each holding a full deep copy.
 *
 * Clips are matched by id and tracks by id, so reordering is handled. If nothing
 * changed at all, `prev` is returned as-is.
 */
export function shareStructure<TTrackMeta, TClipMeta>(
  prev: TimelineDocument<TTrackMeta, TClipMeta> | null | undefined,
  next: TimelineDocument<TTrackMeta, TClipMeta>,
): TimelineDocument<TTrackMeta, TClipMeta> {
  if (!prev || prev === next) {
    return next
  }

  const prevClips = new Map<string, TimelineClip<TClipMeta>>()
  const prevTracks = new Map<string, TimelineTrack<TTrackMeta, TClipMeta>>()
  for (const track of prev.tracks) {
    prevTracks.set(track.id, track)
    for (const clip of track.clips) {
      prevClips.set(clip.id, clip)
    }
  }

  let allTracksReused = next.tracks.length === prev.tracks.length
  const tracks = next.tracks.map((track, trackIndex) => {
    let clipsReused = true
    const clips = track.clips.map(clip => {
      const old = prevClips.get(clip.id)
      if (old && fieldsEqual(old, clip, '')) {
        return old
      }
      clipsReused = false
      return clip
    })

    const oldTrack = prevTracks.get(track.id)
    if (
      oldTrack
      && clipsReused
      && oldTrack.clips.length === clips.length
      && oldTrack.clips.every((clip, index) => clip === clips[index])
      && fieldsEqual(oldTrack, track, 'clips')
    ) {
      if (prev.tracks[trackIndex] !== oldTrack) {
        allTracksReused = false
      }
      return oldTrack
    }

    allTracksReused = false
    return clipsReused && track.clips.every((clip, index) => clip === clips[index])
      ? track
      : { ...track, clips }
  })

  if (allTracksReused && fieldsEqual(prev, next, 'tracks')) {
    return prev
  }
  return { ...next, tracks }
}
