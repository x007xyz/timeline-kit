import {
  DEFAULT_EDIT_POLICIES,
  type EditPolicies,
  type TimelineClip,
  type TimelineDocument,
  type TimelineSelection,
  type TimelineTrack,
} from './types'

function clonePlainValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(item => clonePlainValue(item)) as unknown as T
  }

  const record = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(record)) {
    result[key] = clonePlainValue(record[key])
  }
  return result as T
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function getMinClipDurationMs(doc: TimelineDocument, policies: EditPolicies): number {
  if (typeof policies.minClipDurationMs === 'number' && policies.minClipDurationMs > 0) {
    return policies.minClipDurationMs
  }

  return doc.fps > 0 ? 1000 / doc.fps : 40
}

function collectExistingClipIds(doc: TimelineDocument): Set<string> {
  const ids = new Set<string>()
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      ids.add(clip.id)
    }
  }
  return ids
}

function createUniqueClipId(baseId: string, existingIds: Set<string>): string {
  const root = baseId || 'clip'
  let index = 2
  let candidate = `${root}-part-${index}`
  while (existingIds.has(candidate)) {
    index += 1
    candidate = `${root}-part-${index}`
  }
  return candidate
}

function createUniqueTrackId(trackType: string, existingTracks: TimelineTrack[]): string {
  const existingIds = new Set(existingTracks.map(track => track.id))
  const prefix = trackType || 'track'
  let index = 1
  let candidate = `${prefix}-${index}`
  while (existingIds.has(candidate)) {
    index += 1
    candidate = `${prefix}-${index}`
  }
  return candidate
}

function createTrackForClipType(trackType: string, existingTracks: TimelineTrack[]): TimelineTrack {
  const normalized = trackType.toLowerCase()
  return {
    id: createUniqueTrackId(trackType, existingTracks),
    name: `${trackType || 'track'} Track`,
    type: trackType || 'video',
    clips: [],
    locked: false,
    visible: ['video', 'image', 'text'].includes(normalized) ? true : undefined,
    muted: ['video', 'audio'].includes(normalized) ? false : undefined,
  }
}

export function cloneClip<TMeta = Record<string, unknown>>(clip: TimelineClip<TMeta>): TimelineClip<TMeta> {
  return {
    ...clip,
    trim: clip.trim ? { ...clip.trim } : undefined,
    meta: clip.meta !== undefined ? clonePlainValue(clip.meta) : undefined,
  }
}

export function cloneTrack<
  TTrackMeta = Record<string, unknown>,
  TClipMeta = Record<string, unknown>,
>(track: TimelineTrack<TTrackMeta, TClipMeta>): TimelineTrack<TTrackMeta, TClipMeta> {
  return {
    ...track,
    clips: track.clips.map(clip => cloneClip(clip)),
    meta: track.meta !== undefined ? clonePlainValue(track.meta) : undefined,
  }
}

export function cloneDocument<
  TTrackMeta = Record<string, unknown>,
  TClipMeta = Record<string, unknown>,
>(doc: TimelineDocument<TTrackMeta, TClipMeta>): TimelineDocument<TTrackMeta, TClipMeta> {
  return {
    ...doc,
    tracks: doc.tracks.map(track => cloneTrack(track)),
    meta: doc.meta !== undefined ? clonePlainValue(doc.meta) : undefined,
  }
}

export function getDocumentDurationMs(doc: TimelineDocument): number {
  let maxEndMs = 0
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      if (clip.endMs > maxEndMs) {
        maxEndMs = clip.endMs
      }
    }
  }
  return maxEndMs
}

export function findClipLocation(
  doc: TimelineDocument,
  clipId: string | null | undefined,
): { trackIndex: number, clipIndex: number, track: TimelineTrack, clip: TimelineClip } | null {
  if (!clipId) {
    return null
  }

  for (let trackIndex = 0; trackIndex < doc.tracks.length; trackIndex += 1) {
    const track = doc.tracks[trackIndex]
    for (let clipIndex = 0; clipIndex < track.clips.length; clipIndex += 1) {
      const clip = track.clips[clipIndex]
      if (clip.id === clipId) {
        return { trackIndex, clipIndex, track, clip }
      }
    }
  }

  return null
}

export function resolveSelection(
  doc: TimelineDocument,
  clipIds: readonly string[],
  primaryClipId?: string | null,
): TimelineSelection {
  const seen = new Set<string>()
  const validClipIds: string[] = []

  for (const id of clipIds) {
    if (!id || seen.has(id)) {
      continue
    }
    if (findClipLocation(doc, id)) {
      seen.add(id)
      validClipIds.push(id)
    }
  }

  if (validClipIds.length === 0) {
    return {
      trackIndex: -1,
      clipIndex: -1,
      clipId: null,
      clipIds: [],
    }
  }

  const chosenPrimary = primaryClipId && seen.has(primaryClipId)
    ? primaryClipId
    : validClipIds[0]
  const location = findClipLocation(doc, chosenPrimary)

  if (!location) {
    return {
      trackIndex: -1,
      clipIndex: -1,
      clipId: null,
      clipIds: [],
    }
  }

  return {
    trackIndex: location.trackIndex,
    clipIndex: location.clipIndex,
    clipId: location.clip.id,
    clipIds: validClipIds,
  }
}

export function cleanupTracks(
  doc: TimelineDocument,
  policies: EditPolicies = DEFAULT_EDIT_POLICIES,
  magnetEnabled: boolean = false,
): { document: TimelineDocument, changed: boolean } {
  const nextDoc = cloneDocument(doc)
  let changed = false

  if (magnetEnabled) {
    for (const track of nextDoc.tracks) {
      if (track.main !== true || track.clips.length === 0) {
        continue
      }

      track.clips.sort((left, right) => left.startMs - right.startMs)
      let cursorMs = 0
      for (const clip of track.clips) {
        const durationMs = Math.max(0, clip.endMs - clip.startMs)
        if (clip.startMs !== cursorMs || clip.endMs !== cursorMs + durationMs) {
          clip.startMs = cursorMs
          clip.endMs = cursorMs + durationMs
          changed = true
        }
        cursorMs += durationMs
      }
    }
  }

  if (policies.removeEmptyTracks) {
    const nonEmpty = nextDoc.tracks.filter(track => track.clips.length > 0)
    if (nonEmpty.length !== nextDoc.tracks.length) {
      nextDoc.tracks = nonEmpty
      changed = true
    }
  }

  if (policies.orderAudioToBottom) {
    const nonAudio = nextDoc.tracks.filter(track => track.type !== 'audio')
    const audio = nextDoc.tracks.filter(track => track.type === 'audio')
    const reordered = [...nonAudio, ...audio]
    const orderChanged = reordered.some((track, index) => track !== nextDoc.tracks[index])
    if (orderChanged) {
      nextDoc.tracks = reordered
      changed = true
    }
  }

  return {
    document: changed ? nextDoc : doc,
    changed,
  }
}

export function trimClip(
  doc: TimelineDocument,
  params: {
    trackIndex: number
    clipIndex: number
    offsetMs: number
    edge: 'start' | 'end'
  },
  policies: EditPolicies = DEFAULT_EDIT_POLICIES,
): { document: TimelineDocument, changed: boolean } {
  const sourceTrack = doc.tracks[params.trackIndex]
  const sourceClip = sourceTrack?.clips[params.clipIndex]
  if (!sourceTrack || !sourceClip || sourceTrack.locked === true || params.offsetMs === 0) {
    return { document: doc, changed: false }
  }

  const nextDoc = cloneDocument(doc)
  const track = nextDoc.tracks[params.trackIndex]
  const clip = track.clips[params.clipIndex]
  const minMs = getMinClipDurationMs(doc, policies)
  const initialStart = clip.startMs
  const initialEnd = clip.endMs
  const initialDuration = Math.max(minMs, initialEnd - initialStart)

  let leftBoundary = 0
  let rightBoundary = Infinity
  if (!policies.allowOverlap) {
    for (let index = 0; index < track.clips.length; index += 1) {
      if (index === params.clipIndex) {
        continue
      }
      const other = track.clips[index]
      if (other.endMs <= initialStart) {
        leftBoundary = Math.max(leftBoundary, other.endMs)
      }
      if (other.startMs >= initialEnd) {
        rightBoundary = Math.min(rightBoundary, other.startMs)
      }
    }
  }

  const isMediaBounded = clip.type === 'video'
    || clip.type === 'audio'
    || clip.trim !== undefined
    || (clip.durationMs !== undefined && clip.durationMs > 0)

  if (isMediaBounded) {
    const origTrim = clip.trim
      ? { ...clip.trim }
      : { startMs: 0, endMs: initialDuration }
    const maxSourceDuration = clip.durationMs && clip.durationMs > 0
      ? Math.max(clip.durationMs, origTrim.endMs)
      : Math.max(initialDuration, origTrim.endMs)

    if (params.edge === 'start') {
      const minStartByTrim = initialStart - origTrim.startMs
      const minAllowedStart = Math.max(0, leftBoundary, minStartByTrim)
      const maxAllowedStart = Math.min(rightBoundary - minMs, initialEnd - minMs)
      if (minAllowedStart > maxAllowedStart) {
        return { document: doc, changed: false }
      }
      const nextStart = clamp(initialStart + params.offsetMs, minAllowedStart, maxAllowedStart)
      if (nextStart === initialStart) {
        return { document: doc, changed: false }
      }
      const appliedDelta = nextStart - initialStart
      clip.startMs = nextStart
      clip.trim = {
        startMs: Math.max(0, origTrim.startMs + appliedDelta),
        endMs: origTrim.endMs,
      }
    }
    else {
      const maxEndByTrim = initialStart - origTrim.startMs + maxSourceDuration
      const minAllowedEnd = initialStart + minMs
      const maxAllowedEnd = Math.min(rightBoundary, maxEndByTrim)
      if (minAllowedEnd > maxAllowedEnd) {
        return { document: doc, changed: false }
      }
      const nextEnd = clamp(initialEnd + params.offsetMs, minAllowedEnd, maxAllowedEnd)
      if (nextEnd === initialEnd) {
        return { document: doc, changed: false }
      }
      clip.endMs = nextEnd
      clip.trim = {
        startMs: origTrim.startMs,
        endMs: origTrim.startMs + (nextEnd - initialStart),
      }
    }
  }
  else {
    if (params.edge === 'start') {
      const minAllowedStart = Math.max(0, leftBoundary)
      const maxAllowedStart = Math.min(rightBoundary - minMs, initialEnd - minMs)
      if (minAllowedStart > maxAllowedStart) {
        return { document: doc, changed: false }
      }
      const nextStart = clamp(initialStart + params.offsetMs, minAllowedStart, maxAllowedStart)
      if (nextStart === initialStart) {
        return { document: doc, changed: false }
      }
      clip.startMs = nextStart
    }
    else {
      const minAllowedEnd = initialStart + minMs
      const maxAllowedEnd = rightBoundary
      if (minAllowedEnd > maxAllowedEnd) {
        return { document: doc, changed: false }
      }
      const nextEnd = clamp(initialEnd + params.offsetMs, minAllowedEnd, maxAllowedEnd)
      if (nextEnd === initialEnd) {
        return { document: doc, changed: false }
      }
      clip.endMs = nextEnd
    }
  }

  return { document: nextDoc, changed: true }
}

export function splitClipAtMs(
  doc: TimelineDocument,
  params: {
    trackIndex: number
    clipIndex: number
    splitMs: number
  },
  policies: EditPolicies = DEFAULT_EDIT_POLICIES,
): {
  document: TimelineDocument
  leftClipId: string | null
  rightClipId: string | null
  changed: boolean
} {
  const sourceTrack = doc.tracks[params.trackIndex]
  const sourceClip = sourceTrack?.clips[params.clipIndex]
  if (!sourceTrack || !sourceClip || sourceTrack.locked === true) {
    return { document: doc, leftClipId: null, rightClipId: null, changed: false }
  }

  const minMs = getMinClipDurationMs(doc, policies)
  const leftDurationMs = params.splitMs - sourceClip.startMs
  const rightDurationMs = sourceClip.endMs - params.splitMs
  if (leftDurationMs < minMs || rightDurationMs < minMs) {
    return { document: doc, leftClipId: null, rightClipId: null, changed: false }
  }

  const nextDoc = cloneDocument(doc)
  const track = nextDoc.tracks[params.trackIndex]
  const originalClip = track.clips[params.clipIndex]
  const existingIds = collectExistingClipIds(nextDoc)
  const rightClipId = createUniqueClipId(originalClip.id, existingIds)

  const leftClip = cloneClip(originalClip)
  leftClip.endMs = params.splitMs

  const rightClip = cloneClip(originalClip)
  rightClip.id = rightClipId
  rightClip.startMs = params.splitMs

  if (originalClip.trim || originalClip.durationMs !== undefined || originalClip.type === 'video' || originalClip.type === 'audio') {
    const baseTrimStart = originalClip.trim?.startMs ?? 0
    const baseTrimEnd = originalClip.trim?.endMs ?? (baseTrimStart + (originalClip.endMs - originalClip.startMs))
    leftClip.trim = {
      startMs: baseTrimStart,
      endMs: baseTrimStart + leftDurationMs,
    }
    rightClip.trim = {
      startMs: baseTrimStart + leftDurationMs,
      endMs: baseTrimEnd,
    }
  }

  track.clips.splice(params.clipIndex, 1, leftClip, rightClip)

  return {
    document: nextDoc,
    leftClipId: leftClip.id,
    rightClipId: rightClip.id,
    changed: true,
  }
}

export function deleteClips(
  doc: TimelineDocument,
  clipIds: readonly string[],
  policies: EditPolicies = DEFAULT_EDIT_POLICIES,
  magnetEnabled: boolean = false,
): { document: TimelineDocument, changed: boolean } {
  if (clipIds.length === 0) {
    return { document: doc, changed: false }
  }

  const targets = new Set(clipIds)
  const nextDoc = cloneDocument(doc)
  let removed = false

  for (const track of nextDoc.tracks) {
    if (track.locked === true) {
      continue
    }
    const remaining = track.clips.filter(clip => !targets.has(clip.id))
    if (remaining.length !== track.clips.length) {
      track.clips = remaining
      removed = true
    }
  }

  if (!removed) {
    return { document: doc, changed: false }
  }

  const cleaned = cleanupTracks(nextDoc, policies, magnetEnabled)
  return {
    document: cleaned.document,
    changed: true,
  }
}

function hasOverlapInTrack(
  track: TimelineTrack,
  startMs: number,
  endMs: number,
  excludeClipId?: string,
): boolean {
  for (const existing of track.clips) {
    if (excludeClipId && existing.id === excludeClipId) {
      continue
    }
    if (startMs < existing.endMs && endMs > existing.startMs) {
      return true
    }
  }
  return false
}

export function moveClip(
  doc: TimelineDocument,
  params: {
    sourceTrackIndex: number
    sourceClipIndex: number
    targetTrackIndex: number
    isNewTrack: boolean
    startMs: number
    endMs: number
    clipType?: string
  },
  policies: EditPolicies = DEFAULT_EDIT_POLICIES,
  magnetEnabled: boolean = false,
): { document: TimelineDocument, selection: TimelineSelection, changed: boolean } {
  const sourceTrack = doc.tracks[params.sourceTrackIndex]
  const sourceClip = sourceTrack?.clips[params.sourceClipIndex]
  if (!sourceTrack || !sourceClip || sourceTrack.locked === true) {
    return {
      document: doc,
      selection: resolveSelection(doc, sourceClip ? [sourceClip.id] : []),
      changed: false,
    }
  }

  const durationMs = Math.max(0, params.endMs - params.startMs)
  const nextStartMs = Math.max(0, Math.round(params.startMs))
  const nextEndMs = nextStartMs + Math.round(durationMs)

  if (
    !params.isNewTrack
    && params.targetTrackIndex === params.sourceTrackIndex
    && nextStartMs === sourceClip.startMs
    && nextEndMs === sourceClip.endMs
  ) {
    // Dropped back where it started: not an edit, so no history entry.
    return {
      document: doc,
      selection: resolveSelection(doc, [sourceClip.id], sourceClip.id),
      changed: false,
    }
  }

  if (!params.isNewTrack) {
    const targetTrack = doc.tracks[params.targetTrackIndex]
    if (!targetTrack || targetTrack.locked === true) {
      return {
        document: doc,
        selection: resolveSelection(doc, [sourceClip.id]),
        changed: false,
      }
    }

    if (!policies.allowCrossTrackType && targetTrack.type !== sourceClip.type) {
      return {
        document: doc,
        selection: resolveSelection(doc, [sourceClip.id]),
        changed: false,
      }
    }

    const isTargetMagnet = targetTrack.main === true && magnetEnabled
    if (!policies.allowOverlap && !isTargetMagnet) {
      if (hasOverlapInTrack(targetTrack, nextStartMs, nextEndMs, sourceClip.id)) {
        return {
          document: doc,
          selection: resolveSelection(doc, [sourceClip.id]),
          changed: false,
        }
      }
    }

    if (policies.canDrop && !policies.canDrop({
      clip: sourceClip,
      sourceTrack,
      targetTrack,
      startMs: nextStartMs,
      endMs: nextEndMs,
    })) {
      return {
        document: doc,
        selection: resolveSelection(doc, [sourceClip.id]),
        changed: false,
      }
    }
  }

  const nextDoc = cloneDocument(doc)
  const nextSourceTrack = nextDoc.tracks[params.sourceTrackIndex]
  const movedClip = nextSourceTrack.clips[params.sourceClipIndex]
  movedClip.startMs = nextStartMs
  movedClip.endMs = nextEndMs

  if (!params.isNewTrack && params.targetTrackIndex === params.sourceTrackIndex) {
    nextSourceTrack.clips.sort((left, right) => left.startMs - right.startMs)
  }
  else {
    nextSourceTrack.clips.splice(params.sourceClipIndex, 1)
    if (params.isNewTrack) {
      const newTrack = createTrackForClipType(params.clipType ?? movedClip.type, nextDoc.tracks)
      newTrack.clips.push(movedClip)
      const insertIndex = clamp(params.targetTrackIndex, 0, nextDoc.tracks.length)
      nextDoc.tracks.splice(insertIndex, 0, newTrack)
    }
    else {
      const nextTargetTrack = nextDoc.tracks[params.targetTrackIndex]
      nextTargetTrack.clips.push(movedClip)
      nextTargetTrack.clips.sort((left, right) => left.startMs - right.startMs)
    }
  }

  const cleaned = cleanupTracks(nextDoc, policies, magnetEnabled)
  return {
    document: cleaned.document,
    selection: resolveSelection(cleaned.document, [movedClip.id], movedClip.id),
    changed: true,
  }
}

export function applyMagnetMove(
  doc: TimelineDocument,
  params: {
    sourceTrackIndex: number
    sourceClipIndex: number
    targetTrackIndex: number
    insertPosition: number
    previewArrangement: TimelineClip[]
    dragClipDurationMs: number
  },
  policies: EditPolicies = DEFAULT_EDIT_POLICIES,
): { document: TimelineDocument, selection: TimelineSelection, changed: boolean } {
  const sourceTrack = doc.tracks[params.sourceTrackIndex]
  const sourceClip = sourceTrack?.clips[params.sourceClipIndex]
  const targetTrack = doc.tracks[params.targetTrackIndex]

  if (!sourceTrack || !sourceClip || !targetTrack || sourceTrack.locked === true || targetTrack.locked === true) {
    return {
      document: doc,
      selection: resolveSelection(doc, sourceClip ? [sourceClip.id] : []),
      changed: false,
    }
  }

  const nextDoc = cloneDocument(doc)
  const nextSourceTrack = nextDoc.tracks[params.sourceTrackIndex]
  const [dragClip] = nextSourceTrack.clips.splice(params.sourceClipIndex, 1)
  const nextTargetTrack = nextDoc.tracks[params.targetTrackIndex]

  let dragStartMs = 0
  for (let index = 0; index < params.insertPosition; index += 1) {
    const prev = params.previewArrangement[index]
    if (prev) {
      dragStartMs = prev.endMs
    }
  }

  const updatedDragClip = cloneClip(dragClip)
  updatedDragClip.startMs = dragStartMs
  updatedDragClip.endMs = dragStartMs + Math.max(0, params.dragClipDurationMs)

  const rebuiltClips: TimelineClip[] = [
    ...params.previewArrangement.slice(0, params.insertPosition).map(clip => cloneClip(clip)),
    updatedDragClip,
    ...params.previewArrangement.slice(params.insertPosition).map(clip => cloneClip(clip)),
  ]
  nextTargetTrack.clips = rebuiltClips

  const cleaned = cleanupTracks(nextDoc, policies, true)
  return {
    document: cleaned.document,
    selection: resolveSelection(cleaned.document, [updatedDragClip.id], updatedDragClip.id),
    changed: true,
  }
}

export function insertClip(
  doc: TimelineDocument,
  params: {
    trackIndex: number
    isNewTrack: boolean
    clip: TimelineClip
  },
  policies: EditPolicies = DEFAULT_EDIT_POLICIES,
  magnetEnabled: boolean = false,
): { document: TimelineDocument, selection: TimelineSelection, changed: boolean } {
  const existingIds = collectExistingClipIds(doc)
  const insertedClip = cloneClip(params.clip)
  if (!insertedClip.id || existingIds.has(insertedClip.id)) {
    insertedClip.id = createUniqueClipId(insertedClip.id || 'clip', existingIds)
  }
  insertedClip.startMs = Math.max(0, Math.round(insertedClip.startMs))
  insertedClip.endMs = Math.max(insertedClip.startMs + 1, Math.round(insertedClip.endMs))

  if (!params.isNewTrack) {
    const targetTrack = doc.tracks[params.trackIndex]
    if (!targetTrack || targetTrack.locked === true) {
      return {
        document: doc,
        selection: resolveSelection(doc, []),
        changed: false,
      }
    }

    if (!policies.allowCrossTrackType && targetTrack.type !== insertedClip.type) {
      return {
        document: doc,
        selection: resolveSelection(doc, []),
        changed: false,
      }
    }

    const isTargetMagnet = targetTrack.main === true && magnetEnabled
    if (!policies.allowOverlap && !isTargetMagnet) {
      if (hasOverlapInTrack(targetTrack, insertedClip.startMs, insertedClip.endMs)) {
        return {
          document: doc,
          selection: resolveSelection(doc, []),
          changed: false,
        }
      }
    }

    if (policies.canDrop && !policies.canDrop({
      clip: insertedClip,
      targetTrack,
      startMs: insertedClip.startMs,
      endMs: insertedClip.endMs,
    })) {
      return {
        document: doc,
        selection: resolveSelection(doc, []),
        changed: false,
      }
    }
  }

  const nextDoc = cloneDocument(doc)
  if (params.isNewTrack) {
    const newTrack = createTrackForClipType(insertedClip.type, nextDoc.tracks)
    newTrack.clips.push(insertedClip)
    const insertIndex = clamp(params.trackIndex, 0, nextDoc.tracks.length)
    nextDoc.tracks.splice(insertIndex, 0, newTrack)
  }
  else {
    const targetTrack = nextDoc.tracks[params.trackIndex]
    targetTrack.clips.push(insertedClip)
    targetTrack.clips.sort((left, right) => left.startMs - right.startMs)
  }

  const cleaned = cleanupTracks(nextDoc, policies, magnetEnabled)
  return {
    document: cleaned.document,
    selection: resolveSelection(cleaned.document, [insertedClip.id], insertedClip.id),
    changed: true,
  }
}

export function toggleTrackFlag(
  doc: TimelineDocument,
  trackIndex: number,
  flag: 'locked' | 'visible' | 'muted',
): { document: TimelineDocument, changed: boolean } {
  const sourceTrack = doc.tracks[trackIndex]
  if (!sourceTrack) {
    return { document: doc, changed: false }
  }

  const nextDoc = cloneDocument(doc)
  const track = nextDoc.tracks[trackIndex]
  if (flag === 'visible') {
    track.visible = !(track.visible ?? true)
  }
  else if (flag === 'locked') {
    track.locked = !(track.locked ?? false)
  }
  else {
    track.muted = !(track.muted ?? false)
  }

  return { document: nextDoc, changed: true }
}
