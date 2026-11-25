import {
  applyMagnetMove,
  cleanupTracks,
  deleteClips,
  getDocumentDurationMs,
  insertClip,
  moveClip,
  splitClipAtMs,
  toggleTrackFlag,
  trimClip,
} from '../model/operations'
import type { TimelineClip } from '../model/types'
import { frameToMs } from '../engine/timeScale'
import type { CommandBus } from './commandBus'
import type { TimelineRenderHints } from './types'

export interface ClipMovePayload {
  sourceTrackIndex: number
  sourceClipIndex: number
  targetTrackIndex: number
  isNewTrack: boolean
  startMs: number
  endMs: number
  clipType?: string
}

export interface ClipMagnetMovePayload {
  sourceTrackIndex: number
  sourceClipIndex: number
  targetTrackIndex: number
  insertPosition: number
  previewArrangement: TimelineClip[]
  dragClipDurationMs: number
}

export interface ClipTrimPayload {
  trackIndex: number
  clipIndex: number
  offsetMs: number
  edge: 'start' | 'end'
}

export interface ClipSplitPayload {
  trackIndex?: number
  clipIndex?: number
  splitMs?: number
}

export interface ClipDeletePayload {
  clipIds?: string[]
}

export interface ClipInsertPayload {
  trackIndex: number
  isNewTrack: boolean
  clip: TimelineClip
}

export interface TrackToggleFlagPayload {
  trackIndex: number
  flag: 'locked' | 'visible' | 'muted'
}

export interface SelectionSetPayload {
  clipIds?: string[]
  clipId?: string | null
}

export interface PlayheadSetPayload {
  frame: number
  clampToDuration?: boolean
}

export interface ScaleSetPayload {
  scale: number
  renderHints?: Partial<TimelineRenderHints>
}

export function registerBuiltinCommands(bus: CommandBus): void {
  bus.register<ClipMovePayload>('clip:move', {
    execute(ctx, payload) {
      const state = ctx.store.getState()
      const result = moveClip(
        state.document,
        payload,
        ctx.getPolicies(),
        state.isMagnetEnabled,
      )
      if (!result.changed) {
        return false
      }
      return ctx.store.setDocument(result.document, {
        pushHistory: true,
        selectionClipIds: result.selection.clipIds,
        primaryClipId: result.selection.clipId,
      })
    },
  })

  bus.register<ClipMagnetMovePayload>('clip:magnet-move', {
    execute(ctx, payload) {
      const state = ctx.store.getState()
      const result = applyMagnetMove(state.document, payload, ctx.getPolicies())
      if (!result.changed) {
        return false
      }
      return ctx.store.setDocument(result.document, {
        pushHistory: true,
        selectionClipIds: result.selection.clipIds,
        primaryClipId: result.selection.clipId,
      })
    },
  })

  bus.register<ClipTrimPayload>('clip:trim', {
    execute(ctx, payload) {
      const state = ctx.store.getState()
      const result = trimClip(state.document, payload, ctx.getPolicies())
      if (!result.changed) {
        return false
      }
      return ctx.store.setDocument(result.document, {
        pushHistory: true,
      })
    },
  })

  bus.register<ClipSplitPayload | undefined>('clip:split', {
    canExecute(ctx, payload) {
      const state = ctx.store.getState()
      const trackIndex = payload?.trackIndex ?? state.selection.trackIndex
      const clipIndex = payload?.clipIndex ?? state.selection.clipIndex
      const track = state.document.tracks[trackIndex]
      const clip = track?.clips[clipIndex]
      if (!track || !clip || track.locked === true) {
        return false
      }
      const splitMs = payload?.splitMs ?? frameToMs(state.currentFrame, state.document.fps)
      const minMs = ctx.getPolicies().minClipDurationMs ?? (state.document.fps > 0 ? 1000 / state.document.fps : 40)
      return splitMs - clip.startMs >= minMs && clip.endMs - splitMs >= minMs
    },
    execute(ctx, payload) {
      const state = ctx.store.getState()
      const trackIndex = payload?.trackIndex ?? state.selection.trackIndex
      const clipIndex = payload?.clipIndex ?? state.selection.clipIndex
      const splitMs = payload?.splitMs ?? frameToMs(state.currentFrame, state.document.fps)
      const result = splitClipAtMs(
        state.document,
        { trackIndex, clipIndex, splitMs },
        ctx.getPolicies(),
      )
      if (!result.changed) {
        return false
      }
      return ctx.store.setDocument(result.document, {
        pushHistory: true,
        selectionClipIds: result.leftClipId ? [result.leftClipId] : [],
        primaryClipId: result.leftClipId,
      })
    },
  })

  bus.register<ClipDeletePayload | undefined>('clip:delete', {
    canExecute(ctx, payload) {
      const state = ctx.store.getState()
      const clipIds = payload?.clipIds ?? state.selection.clipIds
      return clipIds.length > 0
    },
    execute(ctx, payload) {
      const state = ctx.store.getState()
      const clipIds = payload?.clipIds ?? state.selection.clipIds
      const result = deleteClips(
        state.document,
        clipIds,
        ctx.getPolicies(),
        state.isMagnetEnabled,
      )
      if (!result.changed) {
        return false
      }
      return ctx.store.setDocument(result.document, {
        pushHistory: true,
        selectionClipIds: [],
        primaryClipId: null,
      })
    },
  })

  bus.register<ClipInsertPayload>('clip:insert', {
    execute(ctx, payload) {
      const state = ctx.store.getState()
      const result = insertClip(
        state.document,
        payload,
        ctx.getPolicies(),
        state.isMagnetEnabled,
      )
      if (!result.changed) {
        return false
      }
      return ctx.store.setDocument(result.document, {
        pushHistory: true,
        selectionClipIds: result.selection.clipIds,
        primaryClipId: result.selection.clipId,
      })
    },
  })

  bus.register<TrackToggleFlagPayload>('track:toggle-flag', {
    execute(ctx, payload) {
      const state = ctx.store.getState()
      const result = toggleTrackFlag(state.document, payload.trackIndex, payload.flag)
      if (!result.changed) {
        return false
      }
      return ctx.store.setDocument(result.document, {
        pushHistory: true,
      })
    },
  })

  bus.register<SelectionSetPayload>('selection:set', {
    execute(ctx, payload) {
      const clipIds = payload?.clipIds ?? (payload?.clipId ? [payload.clipId] : [])
      return ctx.store.setSelection(clipIds, payload?.clipId ?? clipIds[0] ?? null)
    },
  })

  bus.register('selection:clear', {
    execute(ctx) {
      return ctx.store.clearSelection()
    },
  })

  bus.register<PlayheadSetPayload | number>('playhead:set', {
    execute(ctx, payload) {
      const rawFrame = typeof payload === 'number' ? payload : payload.frame
      const clampToDuration = typeof payload === 'object' && payload !== null
        ? payload.clampToDuration === true
        : false
      const state = ctx.store.getState()
      let nextFrame = Math.max(0, Math.round(rawFrame))
      if (clampToDuration) {
        const durationMs = getDocumentDurationMs(state.document)
        const maxFrame = state.document.fps > 0
          ? Math.round((durationMs / 1000) * state.document.fps)
          : 0
        nextFrame = Math.min(nextFrame, Math.max(0, maxFrame))
      }
      return ctx.store.setCurrentFrame(nextFrame)
    },
  })

  bus.register<ScaleSetPayload | number>('scale:set', {
    execute(ctx, payload) {
      if (typeof payload === 'number') {
        return ctx.store.setTrackScale(payload)
      }
      return ctx.store.setTrackScale(payload.scale, payload.renderHints)
    },
  })

  bus.register<{ step?: number } | undefined>('scale:zoom-in', {
    execute(ctx, payload) {
      const step = payload?.step ?? 10
      const current = ctx.store.getState().trackScale
      return ctx.store.setTrackScale(current + step)
    },
  })

  bus.register<{ step?: number } | undefined>('scale:zoom-out', {
    execute(ctx, payload) {
      const step = payload?.step ?? 10
      const current = ctx.store.getState().trackScale
      return ctx.store.setTrackScale(current - step)
    },
  })

  bus.register('scale:fit', {
    execute(ctx) {
      const fitted = ctx.fitToView?.()
      if (typeof fitted === 'number' && Number.isFinite(fitted)) {
        return ctx.store.setTrackScale(fitted)
      }
      return false
    },
  })

  bus.register('magnet:toggle', {
    execute(ctx) {
      const state = ctx.store.getState()
      const nextMagnet = !state.isMagnetEnabled
      ctx.store.setMagnetEnabled(nextMagnet)
      if (nextMagnet) {
        const cleaned = cleanupTracks(state.document, ctx.getPolicies(), true)
        if (cleaned.changed) {
          ctx.store.setDocument(cleaned.document, { pushHistory: false })
        }
      }
      return true
    },
  })

  bus.register<{ enabled: boolean } | boolean>('magnet:set', {
    execute(ctx, payload) {
      const enabled = typeof payload === 'boolean' ? payload : payload.enabled
      const changed = ctx.store.setMagnetEnabled(enabled)
      if (enabled) {
        const state = ctx.store.getState()
        const cleaned = cleanupTracks(state.document, ctx.getPolicies(), true)
        if (cleaned.changed) {
          ctx.store.setDocument(cleaned.document, { pushHistory: false })
        }
      }
      return changed
    },
  })

  bus.register('history:undo', {
    canExecute(ctx) {
      return ctx.store.getState().canUndo
    },
    execute(ctx) {
      return ctx.store.undo()
    },
  })

  bus.register('history:redo', {
    canExecute(ctx) {
      return ctx.store.getState().canRedo
    },
    execute(ctx) {
      return ctx.store.redo()
    },
  })

  bus.registerAlias('undo', 'history:undo')
  bus.registerAlias('redo', 'history:redo')
  bus.registerAlias('split', 'clip:split')
  bus.registerAlias('delete', 'clip:delete')
  bus.registerAlias('magnet', 'magnet:toggle')
  bus.registerAlias('fit', 'scale:fit')
  bus.registerAlias('zoom-in', 'scale:zoom-in')
  bus.registerAlias('zoom-out', 'scale:zoom-out')
}
