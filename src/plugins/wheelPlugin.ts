import { clampTrackScale, getPixelsPerSecond, msToPx } from '../engine/timeScale'
import type { TimelinePlugin } from './types'

export function createWheelPlugin(): TimelinePlugin {
  let settleTimer: ReturnType<typeof setTimeout> | null = null

  const clearSettleTimer = () => {
    if (settleTimer !== null) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
  }

  return {
    name: 'builtin:wheel',
    interactions: [
      {
        id: 'wheel-navigation',
        priority: 50,
        onWheel(event, ctx) {
          if (event.hit.zone === 'toolbar' || event.hit.zone === 'sidebar' || event.hit.zone === 'outside') {
            return false
          }

          const metrics = ctx.renderer.getViewportMetrics()

          if (event.ctrlKey || event.metaKey) {
            event.originalEvent.preventDefault()
            const state = ctx.store.getState()
            const rawStep = -event.deltaY * 0.08
            const boundedStep = Math.sign(rawStep || (event.deltaY < 0 ? 1 : -1)) * Math.min(10, Math.max(1, Math.abs(rawStep)))
            const nextScale = clampTrackScale(Math.round(state.trackScale + boundedStep))
            if (nextScale === state.trackScale) {
              return true
            }

            const viewportOffsetX = event.hit.x + metrics.trackPaddingLeft - metrics.scrollLeft
            const anchorTimeMs = event.hit.timeMs

            ctx.commands.execute('scale:set', {
              scale: nextScale,
              renderHints: { zoomActive: true },
            })

            const nextPps = getPixelsPerSecond(nextScale, state.document.fps)
            const nextAnchorPx = msToPx(anchorTimeMs, nextPps)
            const nextScrollLeft = Math.max(0, nextAnchorPx + metrics.trackPaddingLeft - viewportOffsetX)
            ctx.renderer.setScrollLeft(nextScrollLeft)

            clearSettleTimer()
            settleTimer = setTimeout(() => {
              const latest = ctx.store.getState().renderHints
              ctx.store.setRenderHints({
                zoomActive: false,
                settleVersion: latest.settleVersion + 1,
              })
              settleTimer = null
            }, 160)

            return true
          }

          if (event.shiftKey && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            event.originalEvent.preventDefault()
            ctx.renderer.setScrollLeft(Math.max(0, metrics.scrollLeft + event.deltaY))
            return true
          }

          return false
        },
      },
    ],
    setup() {
      return clearSettleTimer
    },
  }
}
