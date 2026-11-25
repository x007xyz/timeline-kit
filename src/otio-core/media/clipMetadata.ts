export type FlyCutMediaAssetType = 'video' | 'audio' | 'image' | 'gif' | 'svg'
export type FlyCutMediaStorage = 'opfs' | 'handle'

const FLYCUT_MEDIA_ASSET_TYPES: readonly FlyCutMediaAssetType[] = ['video', 'audio', 'image', 'gif', 'svg']
const FLYCUT_MEDIA_STORAGES: readonly FlyCutMediaStorage[] = ['opfs', 'handle']

export interface FlyCutMediaMetadata {
  assetType: FlyCutMediaAssetType
  mediaId: string
  storage: FlyCutMediaStorage
  mimeType: string
  sourceUrl?: string
  sourceDurationSec?: number
  sourceFps?: number
  width?: number
  height?: number
  waveformId?: string
  filmstripId?: string
  thumbnailId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isFlyCutMediaAssetType(value: unknown): value is FlyCutMediaAssetType {
  return typeof value === 'string' && FLYCUT_MEDIA_ASSET_TYPES.includes(value as FlyCutMediaAssetType)
}

function isFlyCutMediaStorage(value: unknown): value is FlyCutMediaStorage {
  return typeof value === 'string' && FLYCUT_MEDIA_STORAGES.includes(value as FlyCutMediaStorage)
}

export function readFlyCutMediaMetadata(metadata: Record<string, unknown> | undefined): FlyCutMediaMetadata | undefined {
  if (!metadata) {
    return undefined
  }

  const flyCut = metadata.flyCut
  if (!isRecord(flyCut)) {
    return undefined
  }

  const assetType = isFlyCutMediaAssetType(flyCut.assetType) ? flyCut.assetType : undefined
  const mediaId = readString(flyCut.mediaId)
  const storage = isFlyCutMediaStorage(flyCut.storage) ? flyCut.storage : undefined
  const mimeType = readString(flyCut.mimeType)

  if (!assetType || !mediaId || !storage || !mimeType) {
    return undefined
  }

  return {
    assetType,
    mediaId,
    storage,
    mimeType,
    sourceUrl: readString(flyCut.sourceUrl),
    sourceDurationSec: readNumber(flyCut.sourceDurationSec),
    sourceFps: readNumber(flyCut.sourceFps),
    width: readNumber(flyCut.width),
    height: readNumber(flyCut.height),
    waveformId: readString(flyCut.waveformId),
    filmstripId: readString(flyCut.filmstripId),
    thumbnailId: readString(flyCut.thumbnailId),
  }
}

export function writeFlyCutMediaMetadata(
  metadata: Record<string, unknown> | undefined,
  flyCut: FlyCutMediaMetadata | undefined,
): Record<string, unknown> | undefined {
  if (!metadata && !flyCut) {
    return undefined
  }

  const nextMetadata = { ...(metadata ?? {}) }

  if (flyCut) {
    nextMetadata.flyCut = { ...flyCut }
  } else {
    delete nextMetadata.flyCut
  }

  return nextMetadata
}
