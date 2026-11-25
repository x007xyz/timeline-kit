import type { TimelineLayoutSnapshot } from '../engine/layout'
import { detectMagnetState, getMagnetPreviewTransforms } from '../engine/magnet'
import { resolveTargetTrack } from '../engine/placement'
import { collectSnapPoints, findBestSnap } from '../engine/snap'
import { msToPx, pxToMs } from '../engine/timeScale'
import type { TimelinePlugin } from './types'

function getInsertGuidelineY(layout: TimelineLayoutSnapshot, insertIndex: number): number {
  if (layout.tracks.length === 0) {
    return 0
  }
  if (insertIndex <= 0) {
    return layout.tracks[0].startY - 3
  }
  const prevTrack = layout.tracks[Math.min(insertIndex - 1, layout.tracks.length - 1)]
  return prevTrack.endY + 1
}

export function createClipDragPlugin(): TimelinePlugin {
  return {
    name: 'builtin:clip-drag',
    interactions: [
      {
        id: 'clip-drag',
        priority: 70,
        onPointerDown(event, ctx) {
          if (event.hit.zone !== 'clip-body' || event.button !== 0) {
            return null
          }
          if (event.metaKey || event.ctrlKey) {
            return null
          }

          const clipId = event.hit.clipId
          if (!clipId) {
            return null
          }

          const state = ctx.store.getState()
          const sourceTrack = state.document.tracks[event.hit.trackIndex]
          const sourceClip = sourceTrack?.clips[event.hit.clipIndex]
          if (!sourceTrack || !sourceClip) {
            return null
          }

          if (sourceTrack.locked === true) {
            ctx.commands.execute('selection:clear')
            return null
          }

          ctx.renderer.focusContainer?.()
          if (state.selection.clipId !== clipId) {
            ctx.commands.execute('selection:set', { clipIds: [clipId], clipId })
          }

          const layout = ctx.renderer.getLayout()
          const layoutClip = layout.tracks[event.hit.trackIndex]?.clips[event.hit.clipIndex]
          if (!layoutClip) {
            return null
          }

          const originLeftPx = layoutClip.leftPx
          const originWidthPx = Math.max(layoutClip.widthPx, 32)
          const startClientX = event.clientX
          const startClientY = event.clientY
          const durationMs = Math.max(0, sourceClip.endMs - sourceClip.startMs)
          let pending = true
          let currentLeftPx = originLeftPx
          let snappedStartMs: number | undefined
          let previewedClipIds: string[] = []

          const clearMagnetPreviews = () => {
            for (const previewId of previewedClipIds) {
              if (previewId !== clipId) {
                ctx.renderer.setClipPreview(previewId, null)
              }
            }
            previewedClipIds = []
          }

          event.originalEvent.preventDefault()

          return {
            onMove(moveEvent) {
              if (pending) {
                const movedX = Math.abs(moveEvent.clientX - startClientX)
                const movedY = Math.abs(moveEvent.clientY - startClientY)
                if (movedX < 3 && movedY < 3) {
                  return
                }
                pending = false
              }

              const activeState = ctx.store.getState()
              const activeLayout = ctx.renderer.getLayout()
              const policies = ctx.getPolicies()
              const deltaX = moveEvent.clientX - startClientX
              const deltaY = moveEvent.clientY - startClientY
              let nextLeftPx = Math.max(0, originLeftPx + deltaX)

              const targetTrackInfo = resolveTargetTrack(
                activeState.document.tracks,
                activeLayout.tracks,
                moveEvent.hit.y,
                sourceClip,
                {
                  targetStartMs: pxToMs(nextLeftPx, activeLayout.pixelsPerSecond),
                  sourceTrackIndex: event.hit.trackIndex,
                  magnetEnabled: activeState.isMagnetEnabled,
                  policies,
                },
              )

              const magnetDetection = detectMagnetState({
                tracks: activeState.document.tracks,
                tracksLayout: activeLayout.tracks,
                targetTrackIndex: targetTrackInfo.insertIndex,
                isNewTrack: targetTrackInfo.isNewTrack,
                targetX: nextLeftPx,
                cursorX: moveEvent.hit.x,
                dragClipDurationMs: durationMs,
                sourceTrackIndex: event.hit.trackIndex,
                sourceClipId: clipId,
                pixelToMs: px => pxToMs(px, activeLayout.pixelsPerSecond),
                magnetEnabled: activeState.isMagnetEnabled,
              })

              snappedStartMs = undefined
              let verticalGuidelinePx: number | null = null

              if (!magnetDetection.magnetState) {
                const snapPoints = collectSnapPoints(ctx.getSnapProviders(), {
                  layout: activeLayout,
                  currentFrame: activeState.currentFrame,
                  excludeClipIds: new Set([clipId]),
                  targetLeftPx: nextLeftPx,
                  durationMs,
                })
                const snapResult = findBestSnap(
                  nextLeftPx,
                  durationMs,
                  snapPoints,
                  activeLayout.pixelsPerSecond,
                  10,
                )
                if (snapResult) {
                  nextLeftPx = snapResult.leftPx
                  snappedStartMs = snapResult.startMs
                  verticalGuidelinePx = snapResult.guidelineX
                }
              }

              currentLeftPx = nextLeftPx
              ctx.renderer.setClipPreview(clipId, {
                leftPx: nextLeftPx,
                translateY: deltaY,
                isDragging: true,
              })

              clearMagnetPreviews()
              if (magnetDetection.magnetState) {
                const targetLayout = activeLayout.tracks[magnetDetection.magnetState.targetTrackIndex]
                const transforms = getMagnetPreviewTransforms(
                  magnetDetection.magnetState,
                  clipId,
                  ms => msToPx(ms, activeLayout.pixelsPerSecond),
                  targetLayout,
                )
                for (const transform of transforms) {
                  ctx.renderer.setClipPreview(transform.clipId, {
                    translateX: transform.offsetX,
                  })
                  previewedClipIds.push(transform.clipId)
                }
              }

              if (targetTrackInfo.isNewTrack) {
                ctx.renderer.setOverlay({
                  verticalGuidelinePx,
                  horizontalGuidelinePx: getInsertGuidelineY(activeLayout, targetTrackInfo.insertIndex),
                  dragPreview: null,
                })
              }
              else {
                const targetLayout = activeLayout.tracks[targetTrackInfo.insertIndex]
                ctx.renderer.setOverlay({
                  verticalGuidelinePx,
                  horizontalGuidelinePx: null,
                  dragPreview: targetLayout && !magnetDetection.magnetState
                    ? {
                        leftPx: nextLeftPx,
                        topPx: targetLayout.startY,
                        widthPx: originWidthPx,
                        heightPx: targetLayout.height,
                      }
                    : null,
                })
              }
            },
            onEnd(endEvent) {
              clearMagnetPreviews()
              ctx.renderer.clearAllClipPreviews()
              ctx.renderer.clearOverlay()

              if (pending) {
                return
              }

              const activeState = ctx.store.getState()
              const activeLayout = ctx.renderer.getLayout()
              const policies = ctx.getPolicies()
              const startMs = snappedStartMs ?? Math.max(0, Math.round(pxToMs(currentLeftPx, activeLayout.pixelsPerSecond)))
              const endMs = startMs + durationMs

              const targetInfo = resolveTargetTrack(
                activeState.document.tracks,
                activeLayout.tracks,
                endEvent.hit.y,
                sourceClip,
                {
                  targetStartMs: startMs,
                  sourceTrackIndex: event.hit.trackIndex,
                  magnetEnabled: activeState.isMagnetEnabled,
                  policies,
                },
              )

              const magnetDetection = detectMagnetState({
                tracks: activeState.document.tracks,
                tracksLayout: activeLayout.tracks,
                targetTrackIndex: targetInfo.insertIndex,
                isNewTrack: targetInfo.isNewTrack,
                targetX: currentLeftPx,
                cursorX: endEvent.hit.x,
                dragClipDurationMs: durationMs,
                sourceTrackIndex: event.hit.trackIndex,
                sourceClipId: clipId,
                pixelToMs: px => pxToMs(px, activeLayout.pixelsPerSecond),
                magnetEnabled: activeState.isMagnetEnabled,
              })

              if (magnetDetection.magnetState) {
                ctx.commands.execute('clip:magnet-move', {
                  sourceTrackIndex: event.hit.trackIndex,
                  sourceClipIndex: event.hit.clipIndex,
                  targetTrackIndex: magnetDetection.magnetState.targetTrackIndex,
                  insertPosition: magnetDetection.magnetState.insertPosition,
                  previewArrangement: magnetDetection.magnetState.previewArrangement,
                  dragClipDurationMs: magnetDetection.magnetState.dragClipDurationMs,
                })
                return
              }

              ctx.commands.execute('clip:move', {
                sourceTrackIndex: event.hit.trackIndex,
                sourceClipIndex: event.hit.clipIndex,
                targetTrackIndex: targetInfo.insertIndex,
                isNewTrack: targetInfo.isNewTrack,
                startMs,
                endMs,
                clipType: sourceClip.type,
              })
            },
            onCancel() {
              clearMagnetPreviews()
              ctx.renderer.clearAllClipPreviews()
              ctx.renderer.clearOverlay()
            },
          }
        },
      },
    ],
  }
}
