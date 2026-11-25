import { cloneDocument, type TimelineClip, type TimelineEditor, type TimelineTrack } from '../src/index'
import {
  decodeWaveformPeaks,
  getCachedAssetMeta,
  getCachedPeaks,
  getPreviewFrame,
  loadMediaAsset,
  openAudioBufferIterator,
  openPreviewVideoIterator,
  type MediaAssetMeta,
} from './mediabunnyEngine'

export type StageAspect = '16:9' | '9:16' | '1:1'
export type StageMode = 'video' | 'graphics' | 'audio' | 'empty'

export interface StageTransform {
  x: number
  y: number
  scale?: number
}

export interface PreviewPlayerOptions {
  enableGlobalSpaceShortcut?: boolean
}

export interface PlaybackStats {
  playing: boolean
  playbackRate: number
  loop: boolean
  muted: boolean
  aspect: StageAspect
  stageMode: StageMode
  currentTimeMs: number
  framesPainted: number
  audioBuffersScheduled: number
  peakAudioLevel: number
  activeVideoClipId: string | null
  activeImageClipIds: string[]
  activeTextClipIds: string[]
  activeAudioTrackCount: number
}

let activePlayingPauseHook: (() => void) | null = null

export interface TimelinePreviewPlayerHandle {
  destroy: () => void
  isPlaying: () => boolean
  play: () => void
  pause: () => void
  togglePlay: () => void
  setPlaybackRate: (rate: number) => void
  setAspect: (aspect: StageAspect) => void
  setMasterMuted: (muted: boolean) => void
  setLoop: (loop: boolean) => void
  stepFrames: (deltaFrames: number) => void
  seekToStart: () => void
  captureFramePng: () => string
  getPlaybackStats: () => PlaybackStats
}

const ASPECT_DIMENSIONS: Record<StageAspect, { width: number, height: number }> = {
  '16:9': { width: 640, height: 360 },
  '9:16': { width: 360, height: 640 },
  '1:1': { width: 480, height: 480 },
}

const SPEED_CYCLE = [1, 1.5, 2, 0.5] as const
const ADD_TEXT_PRESETS = ['neon', 'variety', 'gradient'] as const

function clampNumber(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

function formatTimecode(ms: number): string {
  const safe = Math.max(0, ms)
  const mins = Math.floor(safe / 60000)
  const secs = Math.floor((safe % 60000) / 1000)
  const tenths = Math.floor((safe % 1000) / 100)
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

interface ActiveAudioStream {
  clipKey: string
  url: string
  trackId: string
  gainNode: GainNode
  sources: Set<AudioBufferSourceNode>
  iterator: AsyncGenerator<{ buffer: AudioBuffer, timestamp: number, duration: number }, void, unknown> | null
  cancelled: boolean
}

interface StageBoxLayout {
  clip: TimelineClip
  type: 'image' | 'text'
  locked: boolean
  boxX: number
  boxY: number
  boxW: number
  boxH: number
  normX: number
  normY: number
  scale: number
}

export function createTimelinePreviewPlayer(
  container: HTMLElement,
  editor: TimelineEditor,
  options: PreviewPlayerOptions = {},
): TimelinePreviewPlayerHandle {
  const shell = document.createElement('div')
  shell.className = 'tk-preview-shell'

  // Stage top toolbar
  const stageToolbar = document.createElement('div')
  stageToolbar.className = 'tk-stage-toolbar'

  const aspectGroup = document.createElement('div')
  aspectGroup.className = 'tk-stage-group'
  const aspectButtons = new Map<StageAspect, HTMLButtonElement>()
  for (const aspect of ['16:9', '9:16', '1:1'] as const) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'tk-stage-btn'
    btn.dataset.stageAspect = aspect
    btn.textContent = aspect
    aspectButtons.set(aspect, btn)
    aspectGroup.appendChild(btn)
  }

  const stageActionGroup = document.createElement('div')
  stageActionGroup.className = 'tk-stage-group'

  const gridBtn = document.createElement('button')
  gridBtn.type = 'button'
  gridBtn.className = 'tk-stage-btn'
  gridBtn.dataset.stageAction = 'grid'
  gridBtn.textContent = '网格参考线'

  const addTextBtn = document.createElement('button')
  addTextBtn.type = 'button'
  addTextBtn.className = 'tk-stage-btn'
  addTextBtn.dataset.stageAction = 'add-text'
  addTextBtn.textContent = '+ 花字'

  const snapshotBtn = document.createElement('button')
  snapshotBtn.type = 'button'
  snapshotBtn.className = 'tk-stage-btn'
  snapshotBtn.dataset.stageAction = 'snapshot'
  snapshotBtn.textContent = '📷 截图'

  const snapshotBadge = document.createElement('span')
  snapshotBadge.className = 'tk-stage-snapshot-badge'

  stageActionGroup.append(gridBtn, addTextBtn, snapshotBtn, snapshotBadge)
  stageToolbar.append(aspectGroup, stageActionGroup)

  // Stage viewport + aspect-matched frame + interactive DOM overlay
  const stage = document.createElement('div')
  stage.className = 'tk-preview-stage'
  stage.dataset.aspect = '16:9'

  const stageFrame = document.createElement('div')
  stageFrame.className = 'tk-stage-frame'
  stageFrame.dataset.aspect = '16:9'

  const previewCanvas = document.createElement('canvas')
  previewCanvas.className = 'tk-preview-canvas'
  previewCanvas.width = 640
  previewCanvas.height = 360
  previewCanvas.dataset.decoder = 'mediabunny'
  previewCanvas.dataset.decoded = 'empty'
  previewCanvas.dataset.aspect = '16:9'
  previewCanvas.dataset.framesPainted = '0'

  const stageOverlay = document.createElement('div')
  stageOverlay.className = 'tk-stage-overlay'

  stageFrame.append(previewCanvas, stageOverlay)
  stage.append(stageFrame)

  // Transport controls
  const controls = document.createElement('div')
  controls.className = 'tk-preview-controls'

  const startBtn = document.createElement('button')
  startBtn.type = 'button'
  startBtn.className = 'tk-stage-btn'
  startBtn.dataset.transport = 'start'
  startBtn.title = '回到开头'
  startBtn.textContent = '⏮'

  const prevFrameBtn = document.createElement('button')
  prevFrameBtn.type = 'button'
  prevFrameBtn.className = 'tk-stage-btn'
  prevFrameBtn.dataset.transport = 'prev-frame'
  prevFrameBtn.title = '上一帧'
  prevFrameBtn.textContent = '-1f'

  const playBtn = document.createElement('button')
  playBtn.type = 'button'
  playBtn.className = 'tk-preview-play-btn'
  playBtn.dataset.transport = 'play'
  playBtn.textContent = '▶ 播放'

  const nextFrameBtn = document.createElement('button')
  nextFrameBtn.type = 'button'
  nextFrameBtn.className = 'tk-stage-btn'
  nextFrameBtn.dataset.transport = 'next-frame'
  nextFrameBtn.title = '下一帧'
  nextFrameBtn.textContent = '+1f'

  const speedBtn = document.createElement('button')
  speedBtn.type = 'button'
  speedBtn.className = 'tk-stage-btn'
  speedBtn.dataset.transport = 'speed'
  speedBtn.textContent = '1x'

  const loopBtn = document.createElement('button')
  loopBtn.type = 'button'
  loopBtn.className = 'tk-stage-btn'
  loopBtn.dataset.transport = 'loop'
  loopBtn.textContent = '循环'

  const muteBtn = document.createElement('button')
  muteBtn.type = 'button'
  muteBtn.className = 'tk-stage-btn'
  muteBtn.dataset.transport = 'mute'
  muteBtn.textContent = '🔊'

  const vuCanvas = document.createElement('canvas')
  vuCanvas.className = 'tk-preview-vu'
  vuCanvas.width = 56
  vuCanvas.height = 14
  vuCanvas.title = 'WebAudio 实时电平表'

  const timeEl = document.createElement('span')
  timeEl.className = 'tk-preview-timecode'

  controls.append(
    startBtn,
    prevFrameBtn,
    playBtn,
    nextFrameBtn,
    speedBtn,
    loopBtn,
    muteBtn,
    vuCanvas,
    timeEl,
  )

  const infoBar = document.createElement('div')
  infoBar.className = 'tk-preview-meta-bar'
  const activeInfoEl = document.createElement('span')
  activeInfoEl.className = 'tk-preview-active-info'
  infoBar.appendChild(activeInfoEl)

  shell.append(stageToolbar, stage, controls, infoBar)
  container.replaceChildren(shell)

  const canvasCtx = previewCanvas.getContext('2d')
  const vuCtx = vuCanvas.getContext('2d')
  const imageCache = new Map<string, HTMLImageElement>()
  const activeAudioStreams = new Map<string, ActiveAudioStream>()

  let audioContext: AudioContext | null = null
  let masterGainNode: GainNode | null = null
  let analyserNode: AnalyserNode | null = null
  let vuSampleBuf: Uint8Array<ArrayBuffer> | null = null
  let freqSampleBuf: Uint8Array<ArrayBuffer> | null = null

  let currentAspect: StageAspect = '16:9'
  let currentStageMode: StageMode = 'empty'
  let showGrid = false
  const pendingAudioStageUrls = new Set<string>()
  let playbackRate = 1
  let loopEnabled = false
  let masterMuted = false
  let addTextCounter = 0

  let playing = false
  let rafId: number | null = null
  let lastTickMs = 0
  let currentTimeMs = 0
  let destroyed = false
  let videoRenderToken = 0

  let framesPainted = 0
  let audioBuffersScheduled = 0
  let peakAudioLevel = 0

  let ownedVideoCanvas: HTMLCanvasElement | null = null
  let ownedVideoUrl: string | null = null
  let hasOwnedVideoFrame = false

  let playbackVideoKey: string | null = null
  let playbackVideoIter: AsyncGenerator<{ canvas: HTMLCanvasElement | OffscreenCanvas, timestamp: number, duration: number }, void, unknown> | null = null
  let nextVideoFrame: { canvas: HTMLCanvasElement | OffscreenCanvas, timestamp: number, duration: number } | null = null
  let videoIterBusy = false

  interface DragSession {
    clipId: string
    clipType: 'image' | 'text'
    startClientX: number
    startClientY: number
    originNormX: number
    originNormY: number
    currentNormX: number
    currentNormY: number
    scale: number
    moved: boolean
  }
  let dragSession: DragSession | null = null
  let dragOverride: { clipId: string, x: number, y: number, scale: number } | null = null

  let latestActiveVideoId: string | null = null
  let latestActiveImageIds: string[] = []
  let latestActiveTextIds: string[] = []
  let latestAudioTrackCount = 0

  function copyFrameToOwnedCanvas(source: HTMLCanvasElement | OffscreenCanvas, url: string): void {
    if (!ownedVideoCanvas) {
      ownedVideoCanvas = document.createElement('canvas')
    }
    if (ownedVideoCanvas.width !== source.width || ownedVideoCanvas.height !== source.height) {
      ownedVideoCanvas.width = source.width
      ownedVideoCanvas.height = source.height
    }
    const ctx = ownedVideoCanvas.getContext('2d')
    ctx?.drawImage(source, 0, 0)
    ownedVideoUrl = url
    hasOwnedVideoFrame = true
  }

  function clearOwnedVideoFrame(): void {
    hasOwnedVideoFrame = false
    ownedVideoUrl = null
  }

  function findActiveClipsAt(timeMs: number): {
    video: { clip: TimelineClip, track: TimelineTrack } | null
    images: Array<{ clip: TimelineClip, track: TimelineTrack }>
    texts: Array<{ clip: TimelineClip, track: TimelineTrack }>
    audioClips: Array<{ clip: TimelineClip, track: TimelineTrack }>
  } {
    const doc = editor.getState().document
    let activeVideo: { clip: TimelineClip, track: TimelineTrack } | null = null
    const images: Array<{ clip: TimelineClip, track: TimelineTrack }> = []
    const texts: Array<{ clip: TimelineClip, track: TimelineTrack }> = []
    const audioClips: Array<{ clip: TimelineClip, track: TimelineTrack }> = []

    for (const track of doc.tracks) {
      for (const clip of track.clips) {
        if (timeMs < clip.startMs || timeMs >= clip.endMs) {
          continue
        }
        if (clip.type === 'video') {
          if (track.visible !== false && !activeVideo) {
            activeVideo = { clip, track }
          }
          if (clip.resource) {
            audioClips.push({ clip, track })
          }
        }
        else if (clip.type === 'image') {
          if (track.visible !== false) {
            images.push({ clip, track })
          }
        }
        else if (clip.type === 'text') {
          if (track.visible !== false) {
            texts.push({ clip, track })
          }
        }
        else if (clip.type === 'audio' && clip.resource) {
          audioClips.push({ clip, track })
        }
      }
    }

    return { video: activeVideo, images, texts, audioClips }
  }

  function resolveStageTransform(
    clip: TimelineClip,
    type: 'image' | 'text',
    indexInType: number,
  ): StageTransform {
    if (dragOverride && dragOverride.clipId === clip.id) {
      return {
        x: dragOverride.x,
        y: dragOverride.y,
        scale: dragOverride.scale,
      }
    }
    const stored = clip.meta?.stage as StageTransform | undefined
    if (stored && typeof stored.x === 'number' && typeof stored.y === 'number') {
      return {
        x: clampNumber(stored.x, 0.06, 0.94),
        y: clampNumber(stored.y, 0.06, 0.94),
        scale: typeof stored.scale === 'number' && stored.scale > 0 ? stored.scale : 1,
      }
    }
    if (type === 'image') {
      return {
        x: clampNumber(0.80 - indexInType * 0.22, 0.14, 0.88),
        y: clampNumber(0.24 + indexInType * 0.06, 0.14, 0.84),
        scale: 1,
      }
    }
    return {
      x: 0.50,
      y: clampNumber(0.82 - indexInType * 0.15, 0.14, 0.90),
      scale: 1,
    }
  }

  function getOrLoadImage(url: string): HTMLImageElement | null {
    if (!url) {
      return null
    }
    let img = imageCache.get(url)
    if (!img) {
      img = document.createElement('img')
      img.onload = () => {
        if (!destroyed) {
          compositeStageFrame()
        }
      }
      img.src = url
      imageCache.set(url, img)
    }
    return img
  }

  function drawFancyTextBox(
    ctx: CanvasRenderingContext2D,
    clip: TimelineClip,
    locked: boolean,
    normX: number,
    normY: number,
    scale: number,
    stageW: number,
    stageH: number,
  ): StageBoxLayout {
    const preset = String(clip.meta?.preset ?? 'neon')
    const label = clip.resource || clip.name
    const fontSize = Math.round(clampNumber(stageW * 0.036 * scale, 13, 28))
    const padX = Math.round(fontSize * 0.72)
    const padY = Math.round(fontSize * 0.36)

    ctx.save()
    ctx.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
    const maxTextW = stageW * 0.86
    const measuredW = Math.min(maxTextW - padX * 2, ctx.measureText(label).width)
    const boxW = Math.round(Math.max(76, measuredW + padX * 2))
    const boxH = Math.round(fontSize + padY * 2)

    const halfW = boxW / 2
    const halfH = boxH / 2
    const cx = clampNumber(normX * stageW, halfW + 8, stageW - halfW - 8)
    const cy = clampNumber(normY * stageH, halfH + 8, stageH - halfH - 8)
    const boxX = Math.round(cx - halfW)
    const boxY = Math.round(cy - halfH)

    drawRoundedRectPath(ctx, boxX, boxY, boxW, boxH, 8)
    if (preset === 'variety') {
      const grad = ctx.createLinearGradient(boxX, boxY, boxX + boxW, boxY + boxH)
      grad.addColorStop(0, '#be185d')
      grad.addColorStop(1, '#f59e0b')
      ctx.fillStyle = grad
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = 'rgba(254, 240, 138, 0.85)'
      ctx.stroke()
    }
    else if (preset === 'gradient') {
      const grad = ctx.createLinearGradient(boxX, boxY, boxX + boxW, boxY + boxH)
      grad.addColorStop(0, '#312e81')
      grad.addColorStop(1, '#7c3aed')
      ctx.fillStyle = grad
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(196, 181, 253, 0.7)'
      ctx.stroke()
    }
    else if (preset === 'subtitle') {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.84)'
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)'
      ctx.stroke()
    }
    else {
      const grad = ctx.createLinearGradient(boxX, boxY, boxX + boxW, boxY + boxH)
      grad.addColorStop(0, '#090d16')
      grad.addColorStop(1, '#1e1b4b')
      ctx.fillStyle = grad
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = '#22d3ee'
      ctx.stroke()
    }

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.clip()
    if (preset === 'variety') {
      ctx.fillStyle = '#fef08a'
      ctx.lineWidth = 2.5
      ctx.strokeStyle = '#881337'
      ctx.strokeText(label, cx, cy, boxW - padX * 1.4)
      ctx.fillText(label, cx, cy, boxW - padX * 1.4)
    }
    else if (preset === 'gradient') {
      const textGrad = ctx.createLinearGradient(boxX + padX, cy, boxX + boxW - padX, cy)
      textGrad.addColorStop(0, '#fde047')
      textGrad.addColorStop(0.5, '#f472b6')
      textGrad.addColorStop(1, '#60a5fa')
      ctx.fillStyle = textGrad
      ctx.fillText(label, cx, cy, boxW - padX * 1.4)
    }
    else if (preset === 'subtitle') {
      ctx.fillStyle = '#f8fafc'
      ctx.fillText(label, cx, cy, boxW - padX * 1.4)
    }
    else {
      ctx.shadowColor = 'rgba(34, 211, 238, 0.85)'
      ctx.shadowBlur = 10
      ctx.fillStyle = '#67e8f9'
      ctx.fillText(label, cx, cy, boxW - padX * 1.4)
    }

    ctx.restore()
    return { clip, type: 'text', locked, boxX, boxY, boxW, boxH, normX: cx / stageW, normY: cy / stageH, scale }
  }

  function drawImageBox(
    ctx: CanvasRenderingContext2D,
    clip: TimelineClip,
    locked: boolean,
    normX: number,
    normY: number,
    scale: number,
    stageW: number,
    stageH: number,
  ): StageBoxLayout {
    const img = getOrLoadImage(clip.resource ?? '')
    const maxW = stageW * 0.24 * scale
    const maxH = stageH * 0.28 * scale
    let boxW = Math.round(maxW)
    let boxH = Math.round(maxW * 0.72)

    if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      const aspect = img.naturalWidth / img.naturalHeight
      if (maxW / maxH > aspect) {
        boxH = Math.round(maxH)
        boxW = Math.round(boxH * aspect)
      }
      else {
        boxW = Math.round(maxW)
        boxH = Math.round(boxW / aspect)
      }
    }

    const halfW = boxW / 2
    const halfH = boxH / 2
    const cx = clampNumber(normX * stageW, halfW + 8, stageW - halfW - 8)
    const cy = clampNumber(normY * stageH, halfH + 8, stageH - halfH - 8)
    const boxX = Math.round(cx - halfW)
    const boxY = Math.round(cy - halfH)

    ctx.save()
    ctx.shadowColor = 'rgba(2, 6, 23, 0.55)'
    ctx.shadowBlur = 12
    drawRoundedRectPath(ctx, boxX, boxY, boxW, boxH, 6)
    ctx.fillStyle = '#0f172a'
    ctx.fill()

    ctx.save()
    drawRoundedRectPath(ctx, boxX, boxY, boxW, boxH, 6)
    ctx.clip()
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, boxX, boxY, boxW, boxH)
    }
    ctx.restore()

    ctx.shadowBlur = 0
    ctx.lineWidth = 1.5
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)'
    drawRoundedRectPath(ctx, boxX, boxY, boxW, boxH, 6)
    ctx.stroke()
    ctx.restore()

    return { clip, type: 'image', locked, boxX, boxY, boxW, boxH, normX: cx / stageW, normY: cy / stageH, scale }
  }

  function syncOverlayHandles(layouts: StageBoxLayout[], stageW: number, stageH: number): void {
    const selectedIds = new Set(editor.getState().selection.clipIds)
    const handles: HTMLElement[] = []

    for (const item of layouts) {
      const handle = document.createElement('div')
      handle.className = 'tk-stage-handle'
      if (selectedIds.has(item.clip.id)) {
        handle.classList.add('is-selected')
      }
      if (item.locked) {
        handle.classList.add('is-locked')
        handle.dataset.locked = 'true'
      }
      handle.dataset.clipId = item.clip.id
      handle.dataset.clipType = item.type
      handle.style.left = `${(item.boxX / stageW) * 100}%`
      handle.style.top = `${(item.boxY / stageH) * 100}%`
      handle.style.width = `${(item.boxW / stageW) * 100}%`
      handle.style.height = `${(item.boxH / stageH) * 100}%`
      handle.title = item.locked
        ? `「${item.clip.name}」所属轨道已锁定`
        : `拖动调整「${item.clip.name}」舞台位置`

      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || destroyed || item.locked) {
          return
        }
        event.preventDefault()
        event.stopPropagation()

        editor.setSelection(item.clip.id)
        dragSession = {
          clipId: item.clip.id,
          clipType: item.type,
          startClientX: event.clientX,
          startClientY: event.clientY,
          originNormX: item.normX,
          originNormY: item.normY,
          currentNormX: item.normX,
          currentNormY: item.normY,
          scale: item.scale,
          moved: false,
        }
        dragOverride = {
          clipId: item.clip.id,
          x: item.normX,
          y: item.normY,
          scale: item.scale,
        }
        compositeStageFrame()
      })

      handles.push(handle)
    }

    stageOverlay.replaceChildren(...handles)
  }

  function drawGraphicsStageBackdrop(ctx: CanvasRenderingContext2D, stageW: number, stageH: number): void {
    const bg = ctx.createLinearGradient(0, 0, 0, stageH)
    bg.addColorStop(0, '#070d1c')
    bg.addColorStop(1, '#0d152a')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, stageW, stageH)

    ctx.fillStyle = 'rgba(148, 163, 184, 0.16)'
    const step = 20
    for (let y = step; y < stageH; y += step) {
      for (let x = step; x < stageW; x += step) {
        ctx.fillRect(x, y, 1.5, 1.5)
      }
    }
  }

  function drawAudioStageVisualizer(
    ctx: CanvasRenderingContext2D,
    stageW: number,
    stageH: number,
    timeMs: number,
    audioClips: Array<{ clip: TimelineClip, track: TimelineTrack }>,
  ): void {
    const bg = ctx.createLinearGradient(0, 0, 0, stageH)
    bg.addColorStop(0, '#030816')
    bg.addColorStop(1, '#0c162c')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, stageW, stageH)

    // Subtle horizontal dB guides
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)'
    ctx.lineWidth = 1
    for (const ratio of [0.3, 0.56, 0.82]) {
      const y = Math.round(stageH * ratio) + 0.5
      ctx.beginPath()
      ctx.moveTo(16, y)
      ctx.lineTo(stageW - 16, y)
      ctx.stroke()
    }

    // Active audio stem pills along the top
    let badgeX = 16
    const badgeY = 14
    ctx.save()
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    ctx.textBaseline = 'middle'
    for (const { clip, track } of audioClips.slice(0, 4)) {
      const role = String(clip.meta?.audioRole ?? (clip.type === 'video' ? 'video' : 'bgm'))
      const isMuted = track.muted === true
      const icon = role === 'voice' ? '🎙️' : role === 'sfx' ? '💥' : role === 'video' ? '🎬' : '🎵'
      const text = `${icon} ${clip.name}${isMuted ? ' [静音]' : ''}`
      const textW = Math.min(180, ctx.measureText(text).width)
      const pillW = Math.round(textW + 16)
      if (badgeX + pillW > stageW - 14) {
        break
      }
      drawRoundedRectPath(ctx, badgeX, badgeY, pillW, 22, 6)
      ctx.fillStyle = isMuted ? 'rgba(127, 29, 29, 0.55)' : 'rgba(15, 23, 42, 0.86)'
      ctx.fill()
      ctx.strokeStyle = isMuted
        ? 'rgba(248, 113, 113, 0.7)'
        : role === 'voice'
          ? 'rgba(52, 211, 153, 0.75)'
          : role === 'sfx'
            ? 'rgba(251, 191, 36, 0.75)'
            : 'rgba(45, 212, 191, 0.75)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = isMuted ? '#fecaca' : '#e2e8f0'
      ctx.fillText(text, badgeX + 8, badgeY + 11, 180)
      badgeX += pillW + 8
    }
    ctx.restore()

    if (playing && !masterMuted && analyserNode && freqSampleBuf && vuSampleBuf) {
      analyserNode.getByteFrequencyData(freqSampleBuf)
      analyserNode.getByteTimeDomainData(vuSampleBuf)

      const barCount = 32
      const areaX = 24
      const areaW = stageW - 48
      const baseBottom = Math.round(stageH * 0.82)
      const maxBarH = Math.round(stageH * 0.44)
      const slotW = areaW / barCount
      const barW = Math.max(3, slotW - 3)

      for (let i = 0; i < barCount; i += 1) {
        const bin = Math.min(freqSampleBuf.length - 1, Math.floor((i / barCount) * 48))
        const amp = Math.max(0.06, freqSampleBuf[bin] / 255)
        const barH = Math.round(amp * maxBarH)
        const bx = areaX + i * slotW
        const by = baseBottom - barH
        ctx.fillStyle = i < 10 ? '#22d3ee' : i < 22 ? '#34d399' : '#fbbf24'
        ctx.fillRect(bx, by, barW, barH)
      }

      // Live oscilloscope trace
      ctx.save()
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(103, 232, 249, 0.88)'
      ctx.lineWidth = 1.6
      const waveMid = stageH * 0.56
      const waveAmp = stageH * 0.14
      const sampleCount = Math.min(vuSampleBuf.length, 128)
      for (let i = 0; i < sampleCount; i += 1) {
        const x = areaX + (i / (sampleCount - 1)) * areaW
        const norm = (vuSampleBuf[i] - 128) / 128
        const y = waveMid + norm * waveAmp
        if (i === 0) {
          ctx.moveTo(x, y)
        }
        else {
          ctx.lineTo(x, y)
        }
      }
      ctx.stroke()
      ctx.restore()
      return
    }

    // Scrub-synchronized PCM window for paused / muted audio stage
    const areaX = 24
    const areaW = stageW - 48
    const rowCount = Math.min(3, audioClips.length)
    const bandTop = 52
    const bandH = Math.max(40, (stageH - bandTop - 22) / Math.max(1, rowCount))

    audioClips.slice(0, rowCount).forEach(({ clip, track }, rowIdx) => {
      const url = clip.resource
      if (!url) {
        return
      }
      const peaks = getCachedPeaks(url)
      if (peaks === undefined && !pendingAudioStageUrls.has(url)) {
        pendingAudioStageUrls.add(url)
        void decodeWaveformPeaks(url).then(() => {
          pendingAudioStageUrls.delete(url)
          if (!destroyed) {
            compositeStageFrame()
          }
        })
      }

      const midY = bandTop + rowIdx * bandH + bandH / 2
      const role = String(clip.meta?.audioRole ?? 'bgm')
      const color = role === 'voice' ? '#34d399' : role === 'sfx' ? '#fbbf24' : '#2dd4bf'
      const totalDur = clip.durationMs ?? Math.max(100, clip.endMs - clip.startMs)
      const sourceMs = (clip.trim?.startMs ?? 0) + (timeMs - clip.startMs)
      const cursorRatio = clampNumber(sourceMs / Math.max(1, totalDur), 0, 1)

      ctx.save()
      ctx.globalAlpha = track.muted === true || masterMuted ? 0.28 : 0.92
      ctx.fillStyle = color
      const bars = 44
      const step = areaW / bars
      for (let b = 0; b < bars; b += 1) {
        const offsetRatio = (b / (bars - 1) - 0.5) * 0.24
        const pos = cursorRatio + offsetRatio
        let amp = 0.08
        if (peaks && pos >= 0 && pos <= 1) {
          const bin = Math.min(peaks.length - 1, Math.max(0, Math.floor(pos * (peaks.length - 1))))
          amp = peaks[bin]
        }
        const h = Math.max(4, amp * (bandH * 0.78))
        ctx.fillRect(areaX + b * step, midY - h / 2, Math.max(2, step - 2.5), h)
      }
      ctx.restore()
    })

    // Playhead cursor line in center
    const centerX = Math.round(stageW / 2) + 0.5
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(centerX, bandTop - 4)
    ctx.lineTo(centerX, stageH - 16)
    ctx.stroke()
  }

  function compositeStageFrame(): void {
    if (!canvasCtx || destroyed) {
      return
    }
    const stageW = previewCanvas.width
    const stageH = previewCanvas.height
    const { video, images, texts, audioClips } = findActiveClipsAt(currentTimeMs)

    latestActiveVideoId = video?.clip.id ?? null
    latestActiveImageIds = images.map(i => i.clip.id)
    latestActiveTextIds = texts.map(t => t.clip.id)
    latestAudioTrackCount = audioClips.length

    canvasCtx.fillStyle = '#020617'
    canvasCtx.fillRect(0, 0, stageW, stageH)

    if (video) {
      currentStageMode = 'video'
      if (hasOwnedVideoFrame && ownedVideoCanvas && ownedVideoUrl === video.clip.resource) {
        const srcW = Math.max(1, ownedVideoCanvas.width)
        const srcH = Math.max(1, ownedVideoCanvas.height)
        const srcAspect = srcW / srcH
        const dstAspect = stageW / stageH
        let drawW: number
        let drawH: number
        let drawX = 0
        let drawY = 0
        if (dstAspect > srcAspect) {
          drawH = stageH
          drawW = drawH * srcAspect
          drawX = (stageW - drawW) / 2
        }
        else {
          drawW = stageW
          drawH = drawW / srcAspect
          drawY = (stageH - drawH) / 2
        }
        canvasCtx.drawImage(ownedVideoCanvas, drawX, drawY, drawW, drawH)
      }
    }
    else if (images.length > 0 || texts.length > 0) {
      currentStageMode = 'graphics'
      previewCanvas.dataset.decoded = 'true'
      drawGraphicsStageBackdrop(canvasCtx, stageW, stageH)
    }
    else if (audioClips.length > 0) {
      currentStageMode = 'audio'
      previewCanvas.dataset.decoded = 'true'
      drawAudioStageVisualizer(canvasCtx, stageW, stageH, currentTimeMs, audioClips)
    }
    else {
      currentStageMode = 'empty'
      previewCanvas.dataset.decoded = 'empty'
      canvasCtx.save()
      canvasCtx.fillStyle = '#64748b'
      canvasCtx.font = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      canvasCtx.textAlign = 'center'
      canvasCtx.textBaseline = 'middle'
      canvasCtx.fillText('当前时间点无可见媒体图层', stageW / 2, stageH / 2)
      canvasCtx.restore()
    }
    previewCanvas.dataset.stageMode = currentStageMode

    const overlayLayouts: StageBoxLayout[] = []
    images.forEach(({ clip, track }, idx) => {
      const tr = resolveStageTransform(clip, 'image', idx)
      overlayLayouts.push(drawImageBox(canvasCtx, clip, track.locked === true, tr.x, tr.y, tr.scale ?? 1, stageW, stageH))
    })

    texts.forEach(({ clip, track }, idx) => {
      const tr = resolveStageTransform(clip, 'text', idx)
      overlayLayouts.push(drawFancyTextBox(canvasCtx, clip, track.locked === true, tr.x, tr.y, tr.scale ?? 1, stageW, stageH))
    })

    if (showGrid) {
      canvasCtx.save()
      canvasCtx.strokeStyle = 'rgba(148, 163, 184, 0.35)'
      canvasCtx.lineWidth = 1
      for (const ratio of [1 / 3, 2 / 3]) {
        const x = Math.round(stageW * ratio) + 0.5
        const y = Math.round(stageH * ratio) + 0.5
        canvasCtx.beginPath()
        canvasCtx.moveTo(x, 0)
        canvasCtx.lineTo(x, stageH)
        canvasCtx.stroke()
        canvasCtx.beginPath()
        canvasCtx.moveTo(0, y)
        canvasCtx.lineTo(stageW, y)
        canvasCtx.stroke()
      }
      canvasCtx.setLineDash([4, 4])
      const mX = Math.round(stageW * 0.08) + 0.5
      const mY = Math.round(stageH * 0.08) + 0.5
      canvasCtx.strokeRect(mX, mY, stageW - mX * 2, stageH - mY * 2)
      canvasCtx.restore()
    }

    if (dragSession) {
      const activeBox = overlayLayouts.find(l => l.clip.id === dragSession?.clipId)
      if (activeBox) {
        dragSession.currentNormX = activeBox.normX
        dragSession.currentNormY = activeBox.normY
      }
    }

    syncOverlayHandles(overlayLayouts, stageW, stageH)
    updateInfoBar(currentTimeMs, video, images, texts, audioClips)
  }

  function updateVuMeter(levelOverride?: number): void {
    let level = levelOverride ?? 0
    if (levelOverride === undefined && analyserNode && vuSampleBuf && playing && !masterMuted) {
      analyserNode.getByteTimeDomainData(vuSampleBuf)
      let maxDev = 0
      for (let i = 0; i < vuSampleBuf.length; i += 1) {
        const dev = Math.abs(vuSampleBuf[i] - 128) / 128
        if (dev > maxDev) {
          maxDev = dev
        }
      }
      level = maxDev
      if (level > peakAudioLevel) {
        peakAudioLevel = level
      }
    }

    if (!vuCtx) {
      return
    }
    const w = vuCanvas.width
    const h = vuCanvas.height
    vuCtx.clearRect(0, 0, w, h)
    vuCtx.fillStyle = '#0f172a'
    vuCtx.fillRect(0, 0, w, h)

    const segments = 10
    const gap = 1.5
    const segW = (w - gap * (segments + 1)) / segments
    const litCount = Math.round(clampNumber(level * 1.4, 0, 1) * segments)
    for (let i = 0; i < segments; i += 1) {
      const sx = gap + i * (segW + gap)
      if (i < litCount) {
        vuCtx.fillStyle = i >= 8 ? '#ef4444' : i >= 6 ? '#f59e0b' : '#22c55e'
      }
      else {
        vuCtx.fillStyle = '#1e293b'
      }
      vuCtx.fillRect(sx, 2, segW, h - 4)
    }
  }

  function formatMetaTag(meta: MediaAssetMeta | null): string {
    if (!meta || meta.displayWidth <= 0) {
      return ''
    }
    const codec = meta.videoCodec ? ` ${meta.videoCodec}` : ''
    return ` [${meta.displayWidth}x${meta.displayHeight}${codec}]`
  }

  function updateInfoBar(
    timeMs: number,
    video: { clip: TimelineClip, track: TimelineTrack } | null,
    images: Array<{ clip: TimelineClip, track: TimelineTrack }>,
    texts: Array<{ clip: TimelineClip, track: TimelineTrack }>,
    audioClips: Array<{ clip: TimelineClip, track: TimelineTrack }>,
  ): void {
    const totalDurMs = editor.getState().document.tracks.reduce(
      (max, t) => Math.max(max, ...t.clips.map(c => c.endMs), 0),
      0,
    )
    timeEl.textContent = `${formatTimecode(timeMs)} / ${formatTimecode(totalDurMs)}`
    const parts: string[] = []
    if (video) {
      const meta = video.clip.resource ? getCachedAssetMeta(video.clip.resource) : null
      parts.push(`🎬 ${video.clip.name}${formatMetaTag(meta)}`)
    }
    if (images.length > 0) {
      parts.push(`🖼️ ${images.map(i => i.clip.name).join(', ')}`)
    }
    if (texts.length > 0) {
      parts.push(`✨ ${texts.map(t => t.clip.name).join(', ')}`)
    }
    if (audioClips.length > 0) {
      parts.push(`🎵 ${audioClips.length} 轨音频`)
    }
    activeInfoEl.textContent = parts.length > 0 ? parts.join(' · ') : '空白时段'
  }

  async function renderStaticVideoFrame(
    clip: TimelineClip,
    timeMs: number,
    token: number,
  ): Promise<void> {
    const url = clip.resource
    if (!url) {
      return
    }
    const sourceSec = Math.max(0, ((clip.trim?.startMs ?? 0) + (timeMs - clip.startMs)) / 1000)
    previewCanvas.dataset.decoded = 'loading'
    previewCanvas.dataset.sourceUrl = url
    previewCanvas.dataset.sourceSec = sourceSec.toFixed(2)

    const result = await getPreviewFrame(url, sourceSec)
    if (destroyed || token !== videoRenderToken) {
      return
    }
    if (result) {
      copyFrameToOwnedCanvas(result.canvas, url)
      previewCanvas.dataset.decoded = 'true'
      previewCanvas.dataset.sourceSec = sourceSec.toFixed(2)
      compositeStageFrame()
    }
    else {
      previewCanvas.dataset.decoded = 'error'
    }
  }

  function closePlaybackVideoStream(): void {
    const iter = playbackVideoIter
    playbackVideoKey = null
    playbackVideoIter = null
    nextVideoFrame = null
    videoIterBusy = false
    if (iter) {
      iter.return?.().catch(() => {})
    }
  }

  async function pumpPlaybackVideo(clip: TimelineClip, timeMs: number): Promise<void> {
    const url = clip.resource
    if (!url || !playing || destroyed) {
      return
    }
    const sourceSec = Math.max(0, ((clip.trim?.startMs ?? 0) + (timeMs - clip.startMs)) / 1000)
    const clipEndSourceSec = ((clip.trim?.startMs ?? 0) + (clip.endMs - clip.startMs)) / 1000
    const clipKey = `${clip.id}:${url}`

    if (playbackVideoKey !== clipKey) {
      closePlaybackVideoStream()
      playbackVideoKey = clipKey
      const opened = await openPreviewVideoIterator(url, sourceSec, clipEndSourceSec)
      if (!playing || destroyed || playbackVideoKey !== clipKey || !opened) {
        opened?.iterator.return?.().catch(() => {})
        return
      }
      playbackVideoIter = opened.iterator
      const first = await playbackVideoIter.next()
      if (!playing || destroyed || playbackVideoKey !== clipKey || first.done) {
        return
      }
      copyFrameToOwnedCanvas(first.value.canvas, url)
      framesPainted += 1
      previewCanvas.dataset.framesPainted = String(framesPainted)
      previewCanvas.dataset.decoded = 'true'
      previewCanvas.dataset.sourceUrl = url
      previewCanvas.dataset.sourceSec = sourceSec.toFixed(2)
      compositeStageFrame()

      const peek = await playbackVideoIter.next()
      if (playing && !destroyed && playbackVideoKey === clipKey && !peek.done) {
        nextVideoFrame = peek.value
      }
      return
    }

    if (videoIterBusy || !playbackVideoIter) {
      return
    }

    if (nextVideoFrame && sourceSec >= nextVideoFrame.timestamp) {
      videoIterBusy = true
      try {
        while (nextVideoFrame && sourceSec >= nextVideoFrame.timestamp) {
          copyFrameToOwnedCanvas(nextVideoFrame.canvas, url)
          framesPainted += 1
          previewCanvas.dataset.framesPainted = String(framesPainted)
          previewCanvas.dataset.decoded = 'true'
          previewCanvas.dataset.sourceSec = sourceSec.toFixed(2)
          compositeStageFrame()
          const res = await playbackVideoIter.next()
          if (res.done || !playing || destroyed || playbackVideoKey !== clipKey) {
            nextVideoFrame = null
            break
          }
          nextVideoFrame = res.value
        }
      }
      finally {
        videoIterBusy = false
      }
    }
  }

  function ensureAudioGraph(): AudioContext | null {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) {
      return null
    }
    if (!audioContext) {
      audioContext = new AudioCtx()
      masterGainNode = audioContext.createGain()
      masterGainNode.gain.value = masterMuted ? 0 : 1
      analyserNode = audioContext.createAnalyser()
      analyserNode.fftSize = 256
      vuSampleBuf = new Uint8Array(analyserNode.fftSize)
      freqSampleBuf = new Uint8Array(analyserNode.frequencyBinCount)
      masterGainNode.connect(analyserNode)
      analyserNode.connect(audioContext.destination)
    }
    return audioContext
  }

  function stopAudioStream(stream: ActiveAudioStream): void {
    stream.cancelled = true
    for (const source of stream.sources) {
      try {
        source.stop()
        source.disconnect()
      }
      catch { /* already stopped or closed */ }
    }
    stream.sources.clear()
    try {
      stream.gainNode.disconnect()
    }
    catch { /* already stopped or closed */ }
    stream.iterator?.return?.().catch(() => {})
    stream.iterator = null
  }

  function stopAllAudioStreams(): void {
    for (const stream of activeAudioStreams.values()) {
      stopAudioStream(stream)
    }
    activeAudioStreams.clear()
  }

  function syncAudioStreamsDuringPlayback(
    timeMs: number,
    audioClips: Array<{ clip: TimelineClip, track: TimelineTrack }>,
  ): void {
    if (!audioContext || !masterGainNode || !playing || destroyed) {
      return
    }
    const ctx = audioContext
    const activeKeys = new Set<string>()

    for (const { clip, track } of audioClips) {
      if (!clip.resource) {
        continue
      }
      const key = `${clip.id}:${clip.resource}`
      activeKeys.add(key)

      const existing = activeAudioStreams.get(key)
      if (existing) {
        existing.gainNode.gain.setTargetAtTime(track.muted === true ? 0 : 1, ctx.currentTime, 0.015)
        continue
      }

      const gainNode = ctx.createGain()
      gainNode.gain.value = track.muted === true ? 0 : 1
      gainNode.connect(masterGainNode)

      const stream: ActiveAudioStream = {
        clipKey: key,
        url: clip.resource,
        trackId: track.id,
        gainNode,
        sources: new Set(),
        iterator: null,
        cancelled: false,
      }
      activeAudioStreams.set(key, stream)

      const startSourceSec = Math.max(0, ((clip.trim?.startMs ?? 0) + (timeMs - clip.startMs)) / 1000)
      const endSourceSec = ((clip.trim?.startMs ?? 0) + (clip.endMs - clip.startMs)) / 1000
      const startCtxTime = ctx.currentTime
      const streamRate = playbackRate

      ;(async () => {
        const opened = await openAudioBufferIterator(clip.resource!, startSourceSec, endSourceSec)
        if (!opened || stream.cancelled || !playing || destroyed) {
          opened?.iterator.return?.().catch(() => {})
          return
        }
        stream.iterator = opened.iterator
        try {
          for await (const { buffer, timestamp } of opened.iterator) {
            if (stream.cancelled || !playing || destroyed) {
              break
            }
            const when = startCtxTime + (timestamp - startSourceSec) / streamRate
            const scaledDur = buffer.duration / streamRate
            if (when + scaledDur < ctx.currentTime - 0.05) {
              continue
            }
            const sourceNode = ctx.createBufferSource()
            sourceNode.buffer = buffer
            sourceNode.playbackRate.value = streamRate
            sourceNode.connect(stream.gainNode)
            stream.sources.add(sourceNode)
            sourceNode.onended = () => {
              stream.sources.delete(sourceNode)
              try {
                sourceNode.disconnect()
              }
              catch { /* already stopped or closed */ }
            }
            if (when >= ctx.currentTime) {
              sourceNode.start(when)
            }
            else {
              const sourceOffset = Math.min(buffer.duration, (ctx.currentTime - when) * streamRate)
              sourceNode.start(ctx.currentTime, sourceOffset)
            }
            audioBuffersScheduled += 1

            const leadMs = (when - ctx.currentTime) * 1000
            if (leadMs > 600) {
              await new Promise(resolve => setTimeout(resolve, Math.min(250, leadMs - 350)))
            }
          }
        }
        catch {
          // Ignore stream cancellation errors
        }
      })()
    }

    for (const [key, stream] of activeAudioStreams.entries()) {
      if (!activeKeys.has(key)) {
        stopAudioStream(stream)
        activeAudioStreams.delete(key)
      }
    }
  }

  function syncMediaElements(timeMs: number): void {
    const { video, audioClips } = findActiveClipsAt(timeMs)

    if (video && video.clip.resource) {
      if (playing) {
        void pumpPlaybackVideo(video.clip, timeMs)
      }
      else {
        videoRenderToken += 1
        void renderStaticVideoFrame(video.clip, timeMs, videoRenderToken)
      }
    }
    else {
      if (playing) {
        closePlaybackVideoStream()
      }
      videoRenderToken += 1
      clearOwnedVideoFrame()
      previewCanvas.dataset.decoded = 'empty'
      delete previewCanvas.dataset.sourceUrl
      delete previewCanvas.dataset.sourceSec
    }

    if (playing) {
      syncAudioStreamsDuringPlayback(timeMs, audioClips)
    }

    compositeStageFrame()
  }

  function syncFromStore(): void {
    if (destroyed) {
      return
    }
    const state = editor.getState()
    const fps = state.document.fps || 24
    if (!playing) {
      currentTimeMs = (state.currentFrame / fps) * 1000
    }
    syncMediaElements(currentTimeMs)
  }

  function stepPlayback(now: number): void {
    if (!playing || destroyed) {
      return
    }
    const deltaMs = Math.min(100, Math.max(0, now - lastTickMs)) * playbackRate
    lastTickMs = now

    updateVuMeter()

    const doc = editor.getState().document
    const fps = doc.fps || 24
    const totalDurMs = doc.tracks.reduce(
      (max, t) => Math.max(max, ...t.clips.map(c => c.endMs), 0),
      0,
    )

    currentTimeMs += deltaMs
    if (currentTimeMs >= totalDurMs && totalDurMs > 0) {
      if (loopEnabled) {
        currentTimeMs = 0
        closePlaybackVideoStream()
        stopAllAudioStreams()
        editor.setCurrentFrame(0)
        syncMediaElements(0)
        rafId = requestAnimationFrame(stepPlayback)
        return
      }
      currentTimeMs = 0
      pause()
      editor.setCurrentFrame(0)
      return
    }

    const nextFrame = Math.round((currentTimeMs / 1000) * fps)
    if (nextFrame !== editor.getCurrentFrame()) {
      editor.setCurrentFrame(nextFrame)
    }
    syncMediaElements(currentTimeMs)
    rafId = requestAnimationFrame(stepPlayback)
  }

  function play(): void {
    if (playing || destroyed) {
      return
    }
    if (activePlayingPauseHook && activePlayingPauseHook !== pause) {
      activePlayingPauseHook()
    }
    activePlayingPauseHook = pause

    const ctx = ensureAudioGraph()
    ctx?.resume().catch(() => {})

    playing = true
    playBtn.textContent = '⏸ 暂停'
    playBtn.classList.add('is-playing')
    const state = editor.getState()
    const fps = state.document.fps || 24
    currentTimeMs = (state.currentFrame / fps) * 1000
    lastTickMs = performance.now()
    syncMediaElements(currentTimeMs)
    rafId = requestAnimationFrame(stepPlayback)
  }

  function pause(): void {
    if (activePlayingPauseHook === pause) {
      activePlayingPauseHook = null
    }
    if (!playing) {
      return
    }
    playing = false
    playBtn.textContent = '▶ 播放'
    playBtn.classList.remove('is-playing')
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    closePlaybackVideoStream()
    stopAllAudioStreams()
    updateVuMeter(0)
    syncMediaElements(currentTimeMs)
  }

  function togglePlay(): void {
    if (playing) {
      pause()
    }
    else {
      play()
    }
  }

  function setAspect(aspect: StageAspect): void {
    if (destroyed) {
      return
    }
    currentAspect = aspect
    const dims = ASPECT_DIMENSIONS[aspect]
    previewCanvas.width = dims.width
    previewCanvas.height = dims.height
    previewCanvas.dataset.aspect = aspect
    stage.dataset.aspect = aspect
    stageFrame.dataset.aspect = aspect
    for (const [key, btn] of aspectButtons.entries()) {
      btn.classList.toggle('is-active', key === aspect)
    }
    compositeStageFrame()
  }

  function setPlaybackRate(rate: number): void {
    playbackRate = clampNumber(rate, 0.25, 4)
    speedBtn.textContent = `${playbackRate}x`
    speedBtn.classList.toggle('is-active', playbackRate !== 1)
    if (playing) {
      stopAllAudioStreams()
      syncAudioStreamsDuringPlayback(currentTimeMs, findActiveClipsAt(currentTimeMs).audioClips)
    }
  }

  function setMasterMuted(muted: boolean): void {
    masterMuted = muted
    muteBtn.textContent = muted ? '🔇' : '🔊'
    muteBtn.classList.toggle('is-active', muted)
    if (masterGainNode && audioContext) {
      masterGainNode.gain.setTargetAtTime(muted ? 0 : 1, audioContext.currentTime, 0.015)
    }
    if (muted) {
      updateVuMeter(0)
    }
  }

  function setLoop(loop: boolean): void {
    loopEnabled = loop
    loopBtn.classList.toggle('is-active', loop)
  }

  function stepFrames(deltaFrames: number): void {
    if (playing) {
      pause()
    }
    const next = Math.max(0, editor.getCurrentFrame() + Math.round(deltaFrames))
    editor.setCurrentFrame(next)
  }

  function seekToStart(): void {
    if (playing) {
      pause()
    }
    editor.setCurrentFrame(0)
  }

  function captureFramePng(): string {
    compositeStageFrame()
    const dataUrl = previewCanvas.toDataURL('image/png')
    shell.dataset.lastSnapshot = dataUrl
    return dataUrl
  }

  function quickAddFancyText(): void {
    const state = editor.getState()
    const fps = state.document.fps || 24
    const startMs = Math.round((state.currentFrame / fps) * 1000)
    const durationMs = 2500
    const endMs = startMs + durationMs

    addTextCounter += 1
    const preset = ADD_TEXT_PRESETS[(addTextCounter - 1) % ADD_TEXT_PRESETS.length]
    const clip: TimelineClip = {
      id: `stage-text-${Date.now()}-${addTextCounter}`,
      type: 'text',
      name: `画板花字 #${addTextCounter}`,
      startMs,
      endMs,
      resource: `舞台花字 #${addTextCounter}`,
      meta: {
        preset,
        stage: {
          x: 0.50,
          y: clampNumber(0.26 + ((addTextCounter - 1) % 3) * 0.16, 0.16, 0.84),
          scale: 1,
        },
      },
    }

    const freeTextTrackIdx = state.document.tracks.findIndex((track) => {
      if (track.type !== 'text' || track.locked === true) {
        return false
      }
      return track.clips.every(existing => startMs >= existing.endMs || endMs <= existing.startMs)
    })

    if (freeTextTrackIdx >= 0) {
      editor.exec('clip:insert', {
        trackIndex: freeTextTrackIdx,
        isNewTrack: false,
        clip,
      })
    }
    else {
      editor.exec('clip:insert', {
        trackIndex: 0,
        isNewTrack: true,
        clip,
      })
    }
  }

  // Event bindings
  const onWindowPointerMove = (event: PointerEvent) => {
    if (!dragSession || destroyed) {
      return
    }
    const rect = stageFrame.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return
    }
    const dx = event.clientX - dragSession.startClientX
    const dy = event.clientY - dragSession.startClientY
    if (!dragSession.moved && (Math.abs(dx) >= 2 || Math.abs(dy) >= 2)) {
      dragSession.moved = true
    }
    const nextX = clampNumber(dragSession.originNormX + dx / rect.width, 0.06, 0.94)
    const nextY = clampNumber(dragSession.originNormY + dy / rect.height, 0.06, 0.94)
    dragSession.currentNormX = nextX
    dragSession.currentNormY = nextY
    dragOverride = {
      clipId: dragSession.clipId,
      x: nextX,
      y: nextY,
      scale: dragSession.scale,
    }
    compositeStageFrame()
  }

  const onWindowPointerUp = () => {
    if (!dragSession) {
      return
    }
    const completed = dragSession
    dragSession = null
    dragOverride = null

    if (completed.moved) {
      const nextDoc = cloneDocument(editor.getDocument())
      for (const track of nextDoc.tracks) {
        const target = track.clips.find(c => c.id === completed.clipId)
        if (target) {
          target.meta = {
            ...(target.meta ?? {}),
            stage: {
              x: Number(completed.currentNormX.toFixed(4)),
              y: Number(completed.currentNormY.toFixed(4)),
              scale: completed.scale,
            },
          }
          break
        }
      }
      editor.setDocument(nextDoc, { pushHistory: true })
    }
    else {
      compositeStageFrame()
    }
  }

  const onWindowKeyDown = (event: KeyboardEvent) => {
    if (destroyed) {
      return
    }
    if (event.key === 'Escape' && dragSession) {
      event.preventDefault()
      dragSession = null
      dragOverride = null
      compositeStageFrame()
      return
    }

    if (event.code !== 'Space' && event.key !== ' ') {
      return
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return
    }
    const target = event.target instanceof HTMLElement ? event.target : null
    if (target) {
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
        return
      }
    }

    const scopeRoot = container.closest('[data-tk-playground], #app') ?? container
    const active = document.activeElement
    const insideScope = Boolean(active && scopeRoot.contains(active))
    if (!options.enableGlobalSpaceShortcut && !insideScope) {
      return
    }

    event.preventDefault()
    togglePlay()
  }

  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)
  window.addEventListener('keydown', onWindowKeyDown)

  for (const [aspect, btn] of aspectButtons.entries()) {
    btn.addEventListener('click', () => {
      btn.blur()
      setAspect(aspect)
    })
  }

  gridBtn.addEventListener('click', () => {
    gridBtn.blur()
    showGrid = !showGrid
    gridBtn.classList.toggle('is-active', showGrid)
    compositeStageFrame()
  })

  addTextBtn.addEventListener('click', () => {
    addTextBtn.blur()
    quickAddFancyText()
  })

  snapshotBtn.addEventListener('click', () => {
    snapshotBtn.blur()
    captureFramePng()
    snapshotBadge.textContent = '已截图 PNG ✓'
    snapshotBadge.classList.add('is-visible')
    setTimeout(() => {
      if (!destroyed) {
        snapshotBadge.classList.remove('is-visible')
      }
    }, 1800)
  })

  startBtn.addEventListener('click', () => {
    startBtn.blur()
    seekToStart()
  })

  prevFrameBtn.addEventListener('click', () => {
    prevFrameBtn.blur()
    stepFrames(-1)
  })

  playBtn.addEventListener('click', () => {
    playBtn.blur()
    togglePlay()
  })

  nextFrameBtn.addEventListener('click', () => {
    nextFrameBtn.blur()
    stepFrames(1)
  })

  speedBtn.addEventListener('click', () => {
    speedBtn.blur()
    const idx = SPEED_CYCLE.indexOf(playbackRate as (typeof SPEED_CYCLE)[number])
    const nextRate = SPEED_CYCLE[(idx + 1) % SPEED_CYCLE.length]
    setPlaybackRate(nextRate)
  })

  loopBtn.addEventListener('click', () => {
    loopBtn.blur()
    setLoop(!loopEnabled)
  })

  muteBtn.addEventListener('click', () => {
    muteBtn.blur()
    setMasterMuted(!masterMuted)
  })

  const unsub = editor.subscribe(({ state, prevState }) => {
    if (destroyed) {
      return
    }
    if (state.document !== prevState.document) {
      if (playing) {
        syncMediaElements(currentTimeMs)
      }
      else {
        syncFromStore()
      }
      return
    }
    if (!playing && state.currentFrame !== prevState.currentFrame) {
      syncFromStore()
      return
    }
    if (state.selection !== prevState.selection) {
      compositeStageFrame()
    }
  })

  // Initialize default aspect & pre-warm initial video + image assets
  setAspect('16:9')
  updateVuMeter(0)
  const initialClips = editor.getState().document.tracks.flatMap(t => t.clips)
  const initialVideos = initialClips.filter(c => c.type === 'video' && c.resource)
  if (initialVideos[0]?.resource) {
    void loadMediaAsset(initialVideos[0].resource)
  }
  for (const imgClip of initialClips) {
    if (imgClip.type === 'image' && imgClip.resource) {
      getOrLoadImage(imgClip.resource)
    }
  }
  syncFromStore()

  return {
    isPlaying: () => playing,
    play,
    pause,
    togglePlay,
    setPlaybackRate,
    setAspect,
    setMasterMuted,
    setLoop,
    stepFrames,
    seekToStart,
    captureFramePng,
    getPlaybackStats: () => ({
      playing,
      playbackRate,
      loop: loopEnabled,
      muted: masterMuted,
      aspect: currentAspect,
      stageMode: currentStageMode,
      currentTimeMs,
      framesPainted,
      audioBuffersScheduled,
      peakAudioLevel,
      activeVideoClipId: latestActiveVideoId,
      activeImageClipIds: [...latestActiveImageIds],
      activeTextClipIds: [...latestActiveTextIds],
      activeAudioTrackCount: latestAudioTrackCount,
    }),
    destroy() {
      destroyed = true
      pause()
      unsub()
      window.removeEventListener('pointermove', onWindowPointerMove)
      window.removeEventListener('pointerup', onWindowPointerUp)
      window.removeEventListener('keydown', onWindowKeyDown)
      closePlaybackVideoStream()
      stopAllAudioStreams()
      if (audioContext) {
        audioContext.close().catch(() => {})
        audioContext = null
      }
      masterGainNode = null
      analyserNode = null
      vuSampleBuf = null
      freqSampleBuf = null
      imageCache.clear()
      container.replaceChildren()
    },
  }
}
