import type { ExternalReference } from '../types'
import {
  readFlyCutMediaMetadata as readFlyCutMediaMetadataBag,
  writeFlyCutMediaMetadata as writeFlyCutMediaMetadataBag,
  type FlyCutMediaMetadata,
} from './clipMetadata'

const MANAGED_MEDIA_SCHEME = 'flycut-media://'

export function createManagedExternalReference(mediaId: string): ExternalReference {
  if (mediaId.length === 0) {
    throw new Error('mediaId must not be empty')
  }

  return {
    OTIO_SCHEMA: 'ExternalReference.1',
    target_url: `${MANAGED_MEDIA_SCHEME}${mediaId}`,
  }
}

export function isManagedExternalReference(reference: Pick<ExternalReference, 'target_url'>): boolean {
  return reference.target_url.startsWith(MANAGED_MEDIA_SCHEME)
}

export function getManagedMediaId(reference: Pick<ExternalReference, 'target_url'>): string | undefined {
  if (!isManagedExternalReference(reference)) {
    return undefined
  }

  const mediaId = reference.target_url.slice(MANAGED_MEDIA_SCHEME.length)
  return mediaId.length > 0 ? mediaId : undefined
}

export function readFlyCutMediaMetadata(metadata: Record<string, unknown> | undefined): FlyCutMediaMetadata | undefined {
  return readFlyCutMediaMetadataBag(metadata)
}

export function writeFlyCutMediaMetadata(
  metadata: Record<string, unknown> | undefined,
  flyCut: FlyCutMediaMetadata | undefined,
): Record<string, unknown> | undefined {
  return writeFlyCutMediaMetadataBag(metadata, flyCut)
}

export function readFlyCutMediaMetadataFromReference(reference: ExternalReference): FlyCutMediaMetadata | undefined {
  return readFlyCutMediaMetadata(reference.metadata)
}

export function writeFlyCutMediaMetadataToReference(
  reference: ExternalReference,
  flyCut: FlyCutMediaMetadata | undefined,
): ExternalReference {
  return {
    ...reference,
    metadata: writeFlyCutMediaMetadata(reference.metadata, flyCut),
  }
}
