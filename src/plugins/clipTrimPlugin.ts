import { pxToMs } from '../engine/timeScale'
import type { TimelinePlugin } from './types'

const MIN_TRIM_VISUAL_PX = 24

export function createClipTrimPlugin(): TimelinePlugin {
  return {
    name: 'builtin:clip-trim',
    interactions: [
      {
        id: 'clip-trim',
        priority: 80,
        onPointerDown(event, ctx) {
          if (event.hit.zone !== 'trim-start' && event.hit.zone !== 'trim-end') {
            return null
          }
          const clipId = event.hit.clipId
          if (!clipId) {
            return null
          }

          const state = ctx.store.getState()
          const track = state.document.tracks[event.hit.trackIndex]
          const clip = track?.clips[event.hit.clipIndex]
          if (!track || !clip || track.locked === true) {
            return null
          }

          const layout = ctx.renderer.getLayout()
          const layoutClip = layout.tracks[event.hit.trackIndex]?.clips[event.hit.clipIndex]
          if (!layoutClip) {
            return null
          }

          ctx.renderer.focusContainer?.()
          ctx.commands.execute('selection:set', { clipIds: [clipId], clipId })

          const edge = event.hit.zone === 'trim-start' ? 'start' : 'end'
          const originLeftPx = layoutClip.leftPx
          const originWidthPx = Math.max(layoutClip.widthPx, MIN_TRIM_VISUAL_PX)
          const startClientX = event.clientX
          let currentLeftPx = originLeftPx
          let currentWidthPx = originWidthPx

          ctx.renderer.setClipPreview(clipId, {
            leftPx: originLeftPx,
            widthPx: originWidthPx,
            isTrimming: true,
          })
          event.originalEvent.preventDefault()

          return {
            onMove(moveEvent) {
              const deltaX = moveEvent.clientX - startClientX
              if (edge === 'start') {
                const maxLeft = originLeftPx + originWidthPx - MIN_TRIM_VISUAL_PX
                const clampedLeft = Math.min(maxLeft, Math.max(0, originLeftPx + deltaX))
                currentLeftPx = clampedLeft
                currentWidthPx = originWidthPx - (clampedLeft - originLeftPx)
                ctx.renderer.setClipPreview(clipId, {
                  leftPx: currentLeftPx,
                  widthPx: currentWidthPx,
                  isTrimming: true,
                })
              }
              else {
                currentWidthPx = Math.max(MIN_TRIM_VISUAL_PX, originWidthPx + deltaX)
                ctx.renderer.setClipPreview(clipId, {
                  widthPx: currentWidthPx,
                  isTrimming: true,
                })
              }
            },
            onEnd() {
              ctx.renderer.clearAllClipPreviews()
              ctx.renderer.clearOverlay()
              const activeLayout = ctx.renderer.getLayout()
              const offsetPx = edge === 'start'
                ? currentLeftPx - originLeftPx
                : currentWidthPx - originWidthPx
              const offsetMs = Math.round(pxToMs(offsetPx, activeLayout.pixelsPerSecond))
              if (offsetMs !== 0) {
                ctx.commands.execute('clip:trim', {
                  trackIndex: event.hit.trackIndex,
                  clipIndex: event.hit.clipIndex,
                  offsetMs,
                  edge,
                })
              }
            },
            onCancel() {
              ctx.renderer.clearAllClipPreviews()
              ctx.renderer.clearOverlay()
            },
          }
        },
      },
    ],
  }
}
