import type { TimelinePlugin } from './types'

export function createSelectionPlugin(): TimelinePlugin {
  return {
    name: 'builtin:selection',
    interactions: [
      {
        id: 'selection',
        priority: 20,
        onPointerDown(event, ctx) {
          if (event.hit.zone === 'toolbar' || event.hit.zone === 'sidebar') {
            return null
          }

          if (event.hit.zone === 'clip-body' && event.hit.clipId) {
            const state = ctx.store.getState()
            const track = state.document.tracks[event.hit.trackIndex]
            if (track?.locked === true) {
              ctx.commands.execute('selection:clear')
              return null
            }

            ctx.renderer.focusContainer?.()
            const clickedId = event.hit.clipId
            if (event.metaKey || event.ctrlKey) {
              const existing = state.selection.clipIds
              const hasId = existing.includes(clickedId)
              const nextIds = hasId
                ? existing.filter(id => id !== clickedId)
                : [...existing, clickedId]
              ctx.commands.execute('selection:set', {
                clipIds: nextIds,
                clipId: nextIds[nextIds.length - 1] ?? null,
              })
            }
            else {
              ctx.commands.execute('selection:set', {
                clipIds: [clickedId],
                clipId: clickedId,
              })
            }
            return {}
          }

          if (event.hit.zone === 'track-empty') {
            ctx.renderer.focusContainer?.()
            ctx.commands.execute('playhead:set', {
              frame: event.hit.frame,
              clampToDuration: true,
            })
            ctx.commands.execute('selection:clear')
            return {}
          }

          ctx.commands.execute('selection:clear')
          return null
        },
      },
    ],
  }
}
