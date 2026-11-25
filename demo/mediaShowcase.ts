import type { ClipRenderContext, MediaProvider, SlotRendererObject } from '../src/index'
import {
  decodeWaveformPeaks,
  extractThumbnails,
  getCachedPeaks,
  getCachedThumbnail,
  quantizeTimeKey,
} from './mediabunnyEngine'

export interface SlotLifecycleStats {
  mounts: number
  updates: number
  destroys: number
}

export type AudioRole = 'voice' | 'bgm' | 'sfx' | 'video'
export type FancyTextPreset = 'neon' | 'variety' | 'gradient' | 'subtitle'

function drawCoverThumb(
  ctx2d: CanvasRenderingContext2D,
  thumb: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  sourceSec: number,
): void {
  ctx2d.save()
  ctx2d.beginPath()
  ctx2d.rect(x, y, w, h)
  ctx2d.clip()

  const srcAspect = thumb.width / Math.max(1, thumb.height)
  const dstAspect = w / Math.max(1, h)
  let drawW = w
  let drawH = h
  let drawX = x
  let drawY = y

  if (dstAspect > srcAspect) {
    drawH = w / srcAspect
    drawY = y - (drawH - h) / 2
  }
  else {
    drawW = h * srcAspect
    drawX = x - (drawW - w) / 2
  }

  ctx2d.drawImage(thumb, drawX, drawY, drawW, drawH)

  ctx2d.fillStyle = 'rgba(2, 6, 23, 0.68)'
  ctx2d.fillRect(x + 2, y + h - 13, Math.min(w - 4, 34), 11)
  ctx2d.fillStyle = '#f8fafc'
  ctx2d.font = '600 9px ui-monospace, SFMono-Regular, monospace'
  ctx2d.fillText(`${sourceSec.toFixed(1)}s`, x + 4, y + h - 4)

  ctx2d.strokeStyle = 'rgba(15, 23, 42, 0.78)'
  ctx2d.lineWidth = 1
  ctx2d.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1))
  ctx2d.restore()
}

export function createShowcaseMediaProvider(): MediaProvider {
  return {
    renderFilmstrip(canvas: HTMLCanvasElement, ctx: ClipRenderContext) {
      const context = canvas.getContext('2d')
      if (!context) {
        return
      }
      const w = canvas.width
      const h = canvas.height
      if (w <= 0 || h <= 0) {
        return
      }

      const url = ctx.clip.resource
      if (!url) {
        return
      }

      canvas.dataset.decoder = 'mediabunny'

      const totalDur = ctx.clip.durationMs ?? Math.max(100, ctx.clip.endMs - ctx.clip.startMs)
      const trimStart = ctx.clip.trim?.startMs ?? 0
      const trimEnd = ctx.clip.trim?.endMs ?? totalDur
      const trimDur = Math.max(100, trimEnd - trimStart)

      const maxFrames = ctx.renderHints.zoomActive
        ? Math.min(3, Math.max(1, Math.floor(w / 72)))
        : Math.max(1, Math.min(10, Math.ceil(w / 58)))
      const slotW = w / maxFrames

      context.fillStyle = '#0f172a'
      context.fillRect(0, 0, w, h)

      const slotRequests: Array<{ index: number, sourceSec: number, key: number }> = []
      const missingTimestamps: number[] = []
      let syncDrawn = 0

      for (let i = 0; i < maxFrames; i += 1) {
        const ratioPos = (i + 0.5) / maxFrames
        const sourceSec = (trimStart + ratioPos * trimDur) / 1000
        const key = quantizeTimeKey(sourceSec)
        const cached = getCachedThumbnail(url, sourceSec)
        if (cached) {
          drawCoverThumb(context, cached, i * slotW, 0, slotW, h, sourceSec)
          syncDrawn += 1
        }
        else {
          slotRequests.push({ index: i, sourceSec, key })
          missingTimestamps.push(sourceSec)
        }
      }

      if (missingTimestamps.length === 0) {
        canvas.dataset.decoded = 'true'
        canvas.dataset.decodedFrames = String(syncDrawn)
        return
      }

      let aborted = false
      canvas.dataset.decoded = 'loading'
      let totalDrawn = syncDrawn

      extractThumbnails(
        url,
        missingTimestamps,
        (frameKey, thumbCanvas) => {
          if (aborted) {
            return
          }
          for (const slot of slotRequests) {
            if (slot.key === frameKey) {
              drawCoverThumb(context, thumbCanvas, slot.index * slotW, 0, slotW, h, slot.sourceSec)
              totalDrawn += 1
            }
          }
        },
        () => aborted,
      ).then(() => {
        if (!aborted) {
          canvas.dataset.decoded = totalDrawn > 0 ? 'true' : 'error'
          canvas.dataset.decodedFrames = String(totalDrawn)
        }
      })

      return () => {
        aborted = true
      }
    },

    renderWaveform(canvas: HTMLCanvasElement, ctx: ClipRenderContext) {
      const context = canvas.getContext('2d')
      if (!context) {
        return
      }
      const w = canvas.width
      const h = canvas.height
      if (w <= 0 || h <= 0) {
        return
      }

      canvas.dataset.decoder = 'mediabunny'

      const url = ctx.clip.resource
      const role: AudioRole = ctx.clip.type === 'video'
        ? 'video'
        : ((ctx.clip.meta?.audioRole as AudioRole | undefined) ?? 'bgm')

      const totalDur = ctx.clip.durationMs ?? Math.max(100, ctx.clip.endMs - ctx.clip.startMs)
      const trimStart = ctx.clip.trim?.startMs ?? 0
      const trimEnd = ctx.clip.trim?.endMs ?? totalDur
      const startRatio = Math.max(0, Math.min(1, trimStart / Math.max(1, totalDur)))
      const endRatio = Math.max(startRatio + 0.01, Math.min(1, trimEnd / Math.max(1, totalDur)))

      const drawPeaks = (peaks: Float32Array | null, status: 'loading' | 'true' | 'silent') => {
        context.clearRect(0, 0, w, h)
        const midY = h / 2

        context.strokeStyle = 'rgba(255, 255, 255, 0.16)'
        context.lineWidth = 1
        context.beginPath()
        context.moveTo(0, midY)
        context.lineTo(w, midY)
        context.stroke()

        if (!peaks) {
          canvas.dataset.decoded = status
          return
        }

        const step = ctx.renderHints.zoomActive ? 6 : 3
        const barWidth = Math.max(1.5, step - 1)
        context.fillStyle = role === 'voice'
          ? '#34d399'
          : role === 'sfx'
            ? '#fbbf24'
            : role === 'video'
              ? '#93c5fd'
              : '#2dd4bf'

        for (let px = 0; px < w; px += step) {
          const u = px / Math.max(1, w)
          const peakPos = startRatio + u * (endRatio - startRatio)
          const binIndex = Math.min(peaks.length - 1, Math.max(0, Math.floor(peakPos * (peaks.length - 1))))
          const amp = peaks[binIndex]
          const barH = Math.max(2, amp * (h * 0.88))
          context.fillRect(px, midY - barH / 2, barWidth, barH)
        }

        canvas.dataset.decoded = 'true'
      }

      if (!url) {
        drawPeaks(null, 'silent')
        return
      }

      const cached = getCachedPeaks(url)
      if (cached !== undefined) {
        drawPeaks(cached, cached ? 'true' : 'silent')
        return
      }

      drawPeaks(null, 'loading')
      let aborted = false
      decodeWaveformPeaks(url).then((peaks) => {
        if (aborted) {
          return
        }
        drawPeaks(peaks, peaks ? 'true' : 'silent')
      })

      return () => {
        aborted = true
      }
    },
  }
}

export function createFancyTextSlotRenderer(
  stats?: SlotLifecycleStats,
): SlotRendererObject<ClipRenderContext> {
  return {
    mount(host, ctx) {
      if (stats) {
        stats.mounts += 1
      }

      const root = document.createElement('div')
      const badge = document.createElement('span')
      badge.className = 'tk-fancy-badge'
      const text = document.createElement('span')
      text.className = 'tk-fancy-text'
      root.append(badge, text)

      const apply = (nextCtx: ClipRenderContext) => {
        const preset = (nextCtx.clip.meta?.preset as FancyTextPreset | undefined) ?? 'neon'
        root.className = `tk-fancy-clip is-${preset}`
        root.dataset.preset = preset
        root.dataset.selected = nextCtx.isSelected ? 'true' : 'false'
        badge.textContent = preset === 'variety'
          ? '花字 · 综艺'
          : preset === 'gradient'
            ? '花字 · 渐变'
            : preset === 'subtitle'
              ? '字幕'
              : '花字 · 霓虹'
        text.textContent = nextCtx.clip.resource || nextCtx.clip.name
      }

      apply(ctx)
      host.replaceChildren(root)

      return {
        update(nextCtx) {
          if (stats) {
            stats.updates += 1
          }
          apply(nextCtx)
        },
        destroy() {
          if (stats) {
            stats.destroys += 1
          }
          host.replaceChildren()
        },
      }
    },
  }
}

export function createImageSlotRenderer(
  stats?: SlotLifecycleStats,
): SlotRendererObject<ClipRenderContext> {
  return {
    mount(host, ctx) {
      if (stats) {
        stats.mounts += 1
      }

      const root = document.createElement('div')
      root.className = 'tk-image-clip'

      const img = document.createElement('img')
      img.className = 'tk-image-clip-thumb'
      img.draggable = false

      const overlay = document.createElement('div')
      overlay.className = 'tk-image-clip-overlay'
      const title = document.createElement('span')
      title.className = 'tk-image-clip-title'
      const formatBadge = document.createElement('span')
      formatBadge.className = 'tk-image-clip-badge'
      overlay.append(title, formatBadge)
      root.append(img, overlay)

      let lastSrc = ''
      const apply = (nextCtx: ClipRenderContext) => {
        const src = nextCtx.clip.resource ?? ''
        if (src && src !== lastSrc) {
          img.src = src
          lastSrc = src
        }
        img.alt = nextCtx.clip.name
        title.textContent = nextCtx.clip.name
        const fmt = String(nextCtx.clip.meta?.format ?? 'JPG').toUpperCase()
        formatBadge.textContent = fmt
        root.dataset.selected = nextCtx.isSelected ? 'true' : 'false'
      }

      apply(ctx)
      host.replaceChildren(root)

      return {
        update(nextCtx) {
          if (stats) {
            stats.updates += 1
          }
          apply(nextCtx)
        },
        destroy() {
          if (stats) {
            stats.destroys += 1
          }
          host.replaceChildren()
        },
      }
    },
  }
}
