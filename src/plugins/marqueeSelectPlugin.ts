import type { TimelinePlugin } from './types'

export function createMarqueeSelectPlugin(): TimelinePlugin {
  return {
    name: 'plugin:marquee-select',
    interactions: [
      {
        id: 'marquee-select',
        priority: 30,
        onPointerDown(event, ctx) {
          if (event.hit.zone !== 'track-empty' || event.button !== 0) {
            return null
          }

          const startX = event.hit.x
          const startY = event.hit.y
          const startClientX = event.clientX
          const startClientY = event.clientY
          let active = false

          const updateMarqueeSelection = (endX: number, endY: number) => {
            const leftPx = Math.min(startX, endX)
            const rightPx = Math.max(startX, endX)
            const topPx = Math.min(startY, endY)
            const bottomPx = Math.max(startY, endY)

            ctx.renderer.setOverlay({
              marqueeRect: {
                leftPx,
                topPx,
                widthPx: Math.max(1, rightPx - leftPx),
                heightPx: Math.max(1, bottomPx - topPx),
              },
            })

            const layout = ctx.renderer.getLayout()
            const selectedIds: string[] = []
            for (const trackLayout of layout.tracks) {
              if (trackLayout.track.locked === true) {
                continue
              }
              if (trackLayout.endY < topPx || trackLayout.startY > bottomPx) {
                continue
              }
              for (const clipLayout of trackLayout.clips) {
                const clipLeft = clipLayout.leftPx
                const clipRight = clipLeft + Math.max(clipLayout.widthPx, 32)
                if (clipRight >= leftPx && clipLeft <= rightPx) {
                  selectedIds.push(clipLayout.clip.id)
                }
              }
            }

            ctx.commands.execute('selection:set', {
              clipIds: selectedIds,
              clipId: selectedIds[0] ?? null,
            })
          }

          return {
            onMove(moveEvent) {
              if (!active) {
                const dx = Math.abs(moveEvent.clientX - startClientX)
                const dy = Math.abs(moveEvent.clientY - startClientY)
                if (dx < 4 && dy < 4) {
                  return
                }
                active = true
                ctx.renderer.focusContainer?.()
              }
              updateMarqueeSelection(moveEvent.hit.x, moveEvent.hit.y)
            },
            onEnd(endEvent) {
              ctx.renderer.setOverlay({ marqueeRect: null })
              if (!active) {
                ctx.commands.execute('playhead:set', {
                  frame: endEvent.hit.frame,
                  clampToDuration: true,
                })
                ctx.commands.execute('selection:clear')
              }
            },
            onCancel() {
              ctx.renderer.setOverlay({ marqueeRect: null })
            },
          }
        },
      },
    ],
  }
}
