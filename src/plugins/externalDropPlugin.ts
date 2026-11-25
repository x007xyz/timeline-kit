import { resolveTargetTrack } from '../engine/placement'
import { collectSnapPoints, findBestSnap } from '../engine/snap'
import { msToPx, pxToMs } from '../engine/timeScale'
import type { TimelineClip } from '../model/types'
import type { TimelineDropEvent, TimelinePlugin } from './types'

export interface ExternalDropItem {
  id?: string
  type: string
  name: string
  durationMs: number
  resource?: string
  meta?: Record<string, unknown>
}

export interface ExternalDropPluginOptions {
  resolveItem: (event: TimelineDropEvent) => ExternalDropItem | null | undefined
}

export function createExternalDropPlugin(options: ExternalDropPluginOptions): TimelinePlugin {
  return {
    name: 'plugin:external-drop',
    interactions: [
      {
        id: 'external-drop',
        priority: 60,
        onDragOver(event, ctx) {
          const item = options.resolveItem(event)
          if (!item) {
            return false
          }

          event.originalEvent.preventDefault()
          const state = ctx.store.getState()
          const layout = ctx.renderer.getLayout()
          const policies = ctx.getPolicies()
          const durationMs = Math.max(100, item.durationMs)
          let leftPx = Math.max(0, event.hit.x)

          const snapPoints = collectSnapPoints(ctx.getSnapProviders(), {
            layout,
            currentFrame: state.currentFrame,
            excludeClipIds: new Set(),
            targetLeftPx: leftPx,
            durationMs,
          })
          const snapResult = findBestSnap(leftPx, durationMs, snapPoints, layout.pixelsPerSecond, 10)
          let guidelinePx: number | null = null
          if (snapResult) {
            leftPx = snapResult.leftPx
            guidelinePx = snapResult.guidelineX
          }

          const startMs = Math.max(0, Math.round(pxToMs(leftPx, layout.pixelsPerSecond)))
          const draftClip: TimelineClip = {
            id: item.id || 'external-drop-preview',
            type: item.type,
            name: item.name,
            startMs,
            endMs: startMs + durationMs,
            resource: item.resource,
            durationMs,
            meta: item.meta,
          }

          const targetInfo = resolveTargetTrack(
            state.document.tracks,
            layout.tracks,
            event.hit.y,
            draftClip,
            {
              targetStartMs: startMs,
              magnetEnabled: state.isMagnetEnabled,
              policies,
            },
          )

          const widthPx = Math.max(32, msToPx(durationMs, layout.pixelsPerSecond))
          const targetTrack = layout.tracks[targetInfo.insertIndex]

          if (targetInfo.isNewTrack) {
            const insertY = layout.tracks.length === 0
              ? 0
              : targetInfo.insertIndex <= 0
                ? layout.tracks[0].startY - 3
                : layout.tracks[Math.min(targetInfo.insertIndex - 1, layout.tracks.length - 1)].endY + 1

            ctx.renderer.setOverlay({
              verticalGuidelinePx: guidelinePx,
              horizontalGuidelinePx: insertY,
              dragPreview: null,
            })
          }
          else {
            ctx.renderer.setOverlay({
              verticalGuidelinePx: guidelinePx,
              horizontalGuidelinePx: null,
              dragPreview: targetTrack
                ? {
                    leftPx,
                    topPx: targetTrack.startY,
                    widthPx,
                    heightPx: targetTrack.height,
                    label: item.name,
                  }
                : null,
            })
          }

          return true
        },
        onDragLeave(ctx) {
          ctx.renderer.clearOverlay()
        },
        onDrop(event, ctx) {
          ctx.renderer.clearOverlay()
          const item = options.resolveItem(event)
          if (!item) {
            return false
          }

          event.originalEvent.preventDefault()
          const state = ctx.store.getState()
          const layout = ctx.renderer.getLayout()
          const policies = ctx.getPolicies()
          const durationMs = Math.max(100, item.durationMs)
          let leftPx = Math.max(0, event.hit.x)

          const snapPoints = collectSnapPoints(ctx.getSnapProviders(), {
            layout,
            currentFrame: state.currentFrame,
            excludeClipIds: new Set(),
            targetLeftPx: leftPx,
            durationMs,
          })
          const snapResult = findBestSnap(leftPx, durationMs, snapPoints, layout.pixelsPerSecond, 10)
          const startMs = snapResult
            ? snapResult.startMs
            : Math.max(0, Math.round(pxToMs(leftPx, layout.pixelsPerSecond)))

          const newClip: TimelineClip = {
            id: item.id || `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type: item.type,
            name: item.name,
            startMs,
            endMs: startMs + durationMs,
            resource: item.resource,
            durationMs,
            meta: item.meta,
          }

          const targetInfo = resolveTargetTrack(
            state.document.tracks,
            layout.tracks,
            event.hit.y,
            newClip,
            {
              targetStartMs: startMs,
              magnetEnabled: state.isMagnetEnabled,
              policies,
            },
          )

          ctx.commands.execute('clip:insert', {
            trackIndex: targetInfo.insertIndex,
            isNewTrack: targetInfo.isNewTrack,
            clip: newClip,
          })
          return true
        },
      },
    ],
  }
}
