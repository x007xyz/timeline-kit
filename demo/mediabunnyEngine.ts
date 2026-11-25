import {
  ALL_FORMATS,
  AudioBufferSink,
  BufferSource,
  CanvasSink,
  Input,
  type InputAudioTrack,
  type InputVideoTrack,
  type WrappedAudioBuffer,
  type WrappedCanvas,
} from 'mediabunny'

export interface MediaAssetMeta {
  durationSec: number
  videoCodec: string | null
  audioCodec: string | null
  displayWidth: number
  displayHeight: number
  sampleRate: number
  numberOfChannels: number
  canDecodeVideo: boolean
  canDecodeAudio: boolean
}

interface LoadedMediaAsset {
  url: string
  input: Input<BufferSource>
  meta: MediaAssetMeta
  videoTrack: InputVideoTrack | null
  audioTrack: InputAudioTrack | null
  thumbSink: CanvasSink | null
  previewSink: CanvasSink | null
  audioSink: AudioBufferSink | null
  thumbCache: Map<number, HTMLCanvasElement>
  thumbQueue: Promise<void>
  previewQueue: Promise<void>
  peaks: Float32Array | null | undefined
  peaksPromise: Promise<Float32Array | null> | null
}

const assetCache = new Map<string, LoadedMediaAsset | null>()
const assetLoadPromises = new Map<string, Promise<LoadedMediaAsset | null>>()

export function quantizeTimeKey(timeSec: number): number {
  return Math.round(Math.max(0, timeSec) * 4) / 4
}

function copyCanvasToHtmlCanvas(
  source: HTMLCanvasElement | OffscreenCanvas,
  targetWidth?: number,
  targetHeight?: number,
): HTMLCanvasElement {
  const copy = document.createElement('canvas')
  copy.width = targetWidth ?? source.width
  copy.height = targetHeight ?? source.height
  const ctx = copy.getContext('2d')
  if (ctx) {
    ctx.drawImage(source, 0, 0, copy.width, copy.height)
  }
  return copy
}

export async function loadMediaAsset(url: string): Promise<LoadedMediaAsset | null> {
  if (assetCache.has(url)) {
    return assetCache.get(url) ?? null
  }
  const pending = assetLoadPromises.get(url)
  if (pending) {
    return pending
  }

  const job = (async (): Promise<LoadedMediaAsset | null> => {
    let input: Input<BufferSource> | null = null
    try {
      const response = await fetch(url)
      if (!response.ok) {
        assetCache.set(url, null)
        return null
      }
      const arrayBuffer = await response.arrayBuffer()
      input = new Input({
        formats: ALL_FORMATS,
        source: new BufferSource(arrayBuffer),
      })

      if (!(await input.canRead())) {
        input.dispose()
        assetCache.set(url, null)
        return null
      }

      const [durationRaw, videoTrack, audioTrack] = await Promise.all([
        input.computeDuration(),
        input.getPrimaryVideoTrack(),
        input.getPrimaryAudioTrack(),
      ])

      const canDecodeVideo = videoTrack ? await videoTrack.canDecode() : false
      const canDecodeAudio = audioTrack ? await audioTrack.canDecode() : false
      const videoCodec = videoTrack ? await videoTrack.getCodec() : null
      const audioCodec = audioTrack ? await audioTrack.getCodec() : null
      const displayWidth = videoTrack ? await videoTrack.getDisplayWidth() : 0
      const displayHeight = videoTrack ? await videoTrack.getDisplayHeight() : 0
      const sampleRate = audioTrack ? await audioTrack.getSampleRate() : 0
      const numberOfChannels = audioTrack ? await audioTrack.getNumberOfChannels() : 0

      const durationSec = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 10
      const thumbSink = canDecodeVideo && videoTrack
        ? new CanvasSink(videoTrack, { width: 128, height: 72, fit: 'cover' })
        : null
      const previewSink = canDecodeVideo && videoTrack
        ? new CanvasSink(videoTrack, { width: 640, height: 360, fit: 'contain' })
        : null
      const audioSink = canDecodeAudio && audioTrack
        ? new AudioBufferSink(audioTrack)
        : null

      const asset: LoadedMediaAsset = {
        url,
        input,
        meta: {
          durationSec,
          videoCodec,
          audioCodec,
          displayWidth,
          displayHeight,
          sampleRate,
          numberOfChannels,
          canDecodeVideo,
          canDecodeAudio,
        },
        videoTrack,
        audioTrack,
        thumbSink,
        previewSink,
        audioSink,
        thumbCache: new Map(),
        thumbQueue: Promise.resolve(),
        previewQueue: Promise.resolve(),
        peaks: undefined,
        peaksPromise: null,
      }

      assetCache.set(url, asset)
      return asset
    }
    catch {
      input?.dispose()
      assetCache.set(url, null)
      return null
    }
    finally {
      assetLoadPromises.delete(url)
    }
  })()

  assetLoadPromises.set(url, job)
  return job
}

export function getCachedAssetMeta(url: string): MediaAssetMeta | null {
  return assetCache.get(url)?.meta ?? null
}

export function getCachedThumbnail(url: string, timeSec: number): HTMLCanvasElement | null {
  const asset = assetCache.get(url)
  if (!asset) {
    return null
  }
  return asset.thumbCache.get(quantizeTimeKey(timeSec)) ?? null
}

export function getCachedPeaks(url: string): Float32Array | null | undefined {
  const asset = assetCache.get(url)
  if (!asset) {
    return asset === null ? null : undefined
  }
  return asset.peaks
}

export async function extractThumbnails(
  url: string,
  timestampsSec: number[],
  onFrame: (key: number, canvas: HTMLCanvasElement) => void,
  isAborted?: () => boolean,
): Promise<number> {
  const asset = await loadMediaAsset(url)
  if (!asset?.thumbSink || isAborted?.()) {
    return 0
  }

  let delivered = 0
  const run = asset.thumbQueue.then(async () => {
    if (!asset.thumbSink || isAborted?.()) {
      return
    }

    const maxSec = Math.max(0.02, asset.meta.durationSec - 0.04)
    const deliveredCachedKeys = new Set<number>()
    const uniqueByKey = new Map<number, number>()
    for (const sec of timestampsSec) {
      const key = quantizeTimeKey(sec)
      const cached = asset.thumbCache.get(key)
      if (cached) {
        if (!deliveredCachedKeys.has(key)) {
          deliveredCachedKeys.add(key)
          onFrame(key, cached)
          delivered += 1
        }
        continue
      }
      if (!uniqueByKey.has(key)) {
        uniqueByKey.set(key, Math.max(0.01, Math.min(maxSec, key)))
      }
    }

    const sortedEntries = Array.from(uniqueByKey.entries()).sort((a, b) => a[0] - b[0])
    if (sortedEntries.length === 0 || isAborted?.()) {
      return
    }

    const iterator = asset.thumbSink.canvasesAtTimestamps(sortedEntries.map(([, q]) => q))
    let idx = 0
    try {
      for await (const wrapped of iterator) {
        if (isAborted?.()) {
          await iterator.return?.()
          return
        }
        const entry = sortedEntries[idx]
        idx += 1
        if (!entry || !wrapped) {
          continue
        }
        const copy = copyCanvasToHtmlCanvas(wrapped.canvas, 128, 72)
        asset.thumbCache.set(entry[0], copy)
        onFrame(entry[0], copy)
        delivered += 1
      }
    }
    catch {
      await iterator.return?.().catch(() => {})
    }
  })

  asset.thumbQueue = run.then(() => undefined, () => undefined)
  await run
  return delivered
}

export async function decodeWaveformPeaks(url: string, sampleBins: number = 360): Promise<Float32Array | null> {
  const asset = await loadMediaAsset(url)
  if (!asset) {
    return null
  }
  if (asset.peaks !== undefined) {
    return asset.peaks
  }
  if (asset.peaksPromise) {
    return asset.peaksPromise
  }

  const job = (async (): Promise<Float32Array | null> => {
    if (!asset.audioSink) {
      asset.peaks = null
      return null
    }

    const peaks = new Float32Array(sampleBins)
    const totalDur = Math.max(0.05, asset.meta.durationSec)
    let globalMax = 0
    let hasSamples = false
    const iterator = asset.audioSink.buffers()

    try {
      for await (const wrapped of iterator) {
        const { buffer, timestamp } = wrapped
        const channelCount = buffer.numberOfChannels
        const len = buffer.length
        if (channelCount === 0 || len === 0) {
          continue
        }
        hasSamples = true
        const channels: Float32Array[] = []
        for (let c = 0; c < channelCount; c += 1) {
          channels.push(buffer.getChannelData(c))
        }
        const sr = buffer.sampleRate || 44100
        const stride = Math.max(1, Math.floor(len / 96))
        for (let i = 0; i < len; i += stride) {
          let sum = 0
          for (let c = 0; c < channelCount; c += 1) {
            sum += Math.abs(channels[c][i])
          }
          const amp = sum / channelCount
          const sampleTime = timestamp + i / sr
          const bin = Math.min(sampleBins - 1, Math.max(0, Math.floor((sampleTime / totalDur) * sampleBins)))
          if (amp > peaks[bin]) {
            peaks[bin] = amp
          }
          if (amp > globalMax) {
            globalMax = amp
          }
        }
      }
    }
    catch {
      await iterator.return?.().catch(() => {})
      if (!hasSamples) {
        asset.peaks = null
        return null
      }
    }
    finally {
      asset.peaksPromise = null
    }

    if (!hasSamples) {
      asset.peaks = null
      return null
    }

    if (globalMax > 0.001) {
      for (let i = 0; i < sampleBins; i += 1) {
        peaks[i] = Math.min(1, Math.max(0.04, peaks[i] / globalMax))
      }
    }

    asset.peaks = peaks
    return peaks
  })()

  asset.peaksPromise = job
  return job
}

export async function getPreviewFrame(
  url: string,
  targetSec: number,
): Promise<{ canvas: HTMLCanvasElement, meta: MediaAssetMeta } | null> {
  const asset = await loadMediaAsset(url)
  if (!asset?.previewSink) {
    return null
  }

  let result: { canvas: HTMLCanvasElement, meta: MediaAssetMeta } | null = null
  const run = asset.previewQueue.then(async () => {
    if (!asset.previewSink) {
      return
    }
    const maxSec = Math.max(0.01, asset.meta.durationSec - 0.03)
    const clampedSec = Math.max(0.01, Math.min(maxSec, targetSec))
    const wrapped = await asset.previewSink.getCanvas(clampedSec)
    if (wrapped) {
      result = {
        canvas: copyCanvasToHtmlCanvas(wrapped.canvas),
        meta: asset.meta,
      }
    }
  })

  asset.previewQueue = run.then(() => undefined, () => undefined)
  await run
  return result
}

export async function openPreviewVideoIterator(
  url: string,
  startSec: number,
  endSec?: number,
): Promise<{ iterator: AsyncGenerator<WrappedCanvas, void, unknown>, meta: MediaAssetMeta } | null> {
  const asset = await loadMediaAsset(url)
  if (!asset?.previewSink) {
    return null
  }
  const maxSec = Math.max(0.02, asset.meta.durationSec - 0.01)
  const clampedStart = Math.max(0, Math.min(maxSec, startSec))
  const clampedEnd = endSec !== undefined ? Math.max(clampedStart + 0.01, Math.min(asset.meta.durationSec, endSec)) : undefined
  return {
    iterator: asset.previewSink.canvases(clampedStart, clampedEnd),
    meta: asset.meta,
  }
}

export async function openAudioBufferIterator(
  url: string,
  startSec: number,
  endSec?: number,
): Promise<{ iterator: AsyncGenerator<WrappedAudioBuffer, void, unknown>, meta: MediaAssetMeta } | null> {
  const asset = await loadMediaAsset(url)
  if (!asset?.audioSink) {
    return null
  }
  const clampedStart = Math.max(0, Math.min(asset.meta.durationSec, startSec))
  const clampedEnd = endSec !== undefined ? Math.max(clampedStart + 0.01, Math.min(asset.meta.durationSec, endSec)) : undefined
  return {
    iterator: asset.audioSink.buffers(clampedStart, clampedEnd),
    meta: asset.meta,
  }
}
