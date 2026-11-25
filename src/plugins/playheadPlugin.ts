import type { PluginContext, TimelinePlugin } from './types'

export function createPlayheadPlugin(): TimelinePlugin {
  let repeatDelayTimer: ReturnType<typeof setTimeout> | null = null
  let repeatIntervalTimer: ReturnType<typeof setInterval> | null = null
  let activeDirection: 'left' | 'right' | null = null

  const clearTimers = () => {
    if (repeatDelayTimer !== null) {
      clearTimeout(repeatDelayTimer)
      repeatDelayTimer = null
    }
    if (repeatIntervalTimer !== null) {
      clearInterval(repeatIntervalTimer)
      repeatIntervalTimer = null
    }
    activeDirection = null
  }

  const stepFrame = (ctx: PluginContext, delta: number) => {
    const current = ctx.store.getState().currentFrame
    ctx.commands.execute('playhead:set', {
      frame: Math.max(0, current + delta),
      clampToDuration: true,
    })
  }

  const startRepeat = (ctx: PluginContext, direction: 'left' | 'right') => {
    if (activeDirection === direction && (repeatDelayTimer !== null || repeatIntervalTimer !== null)) {
      return
    }
    clearTimers()
    activeDirection = direction
    const step = direction === 'left' ? -1 : 1
    stepFrame(ctx, step)

    repeatDelayTimer = setTimeout(() => {
      const fps = ctx.store.getState().document.fps || 24
      repeatIntervalTimer = setInterval(() => {
        stepFrame(ctx, step)
      }, Math.max(16, Math.round(1000 / fps)))
      repeatDelayTimer = null
    }, 450)
  }

  return {
    name: 'builtin:playhead',
    interactions: [
      {
        id: 'playhead-scrub',
        priority: 100,
        onPointerDown(event, ctx) {
          if (event.hit.zone !== 'playhead' && event.hit.zone !== 'ruler') {
            return null
          }

          ctx.commands.execute('playhead:set', {
            frame: event.hit.frame,
            clampToDuration: true,
          })
          event.originalEvent.preventDefault()

          return {
            onMove(moveEvent) {
              ctx.commands.execute('playhead:set', {
                frame: moveEvent.hit.frame,
                clampToDuration: true,
              })
            },
          }
        },
        onKeyDown(event, ctx) {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            startRepeat(ctx, 'left')
            return true
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            startRepeat(ctx, 'right')
            return true
          }
          return false
        },
        onKeyUp(event) {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            clearTimers()
            return true
          }
          return false
        },
      },
    ],
    setup() {
      return clearTimers
    },
  }
}
