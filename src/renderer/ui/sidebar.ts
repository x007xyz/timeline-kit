import type { TimelineLayoutSnapshot } from '../../engine/layout'
import {
  normalizeSlotRenderer,
  type SidebarConfig,
  type SlotHandle,
  type SlotRenderer,
  type TrackConfigMap,
  type TrackHeaderContext,
} from '../types'
import { createTrackActionIcon, createTrackTypeIcon } from './icons'

interface MountedTrackLabel {
  trackId: string
  rowEl: HTMLDivElement
  iconHost: HTMLDivElement
  controlsEl: HTMLDivElement
  slotRef?: SlotRenderer<TrackHeaderContext>
  slotHandle?: SlotHandle<TrackHeaderContext>
}

export class SidebarRenderer {
  private readonly sidebarEl: HTMLElement
  private readonly headerEl: HTMLElement
  private readonly bodyEl: HTMLElement
  private readonly mountedRows: Map<string, MountedTrackLabel>

  constructor(sidebarEl: HTMLElement, headerEl: HTMLElement, bodyEl: HTMLElement) {
    this.sidebarEl = sidebarEl
    this.headerEl = headerEl
    this.bodyEl = bodyEl
    this.mountedRows = new Map()
  }

  render(
    layout: TimelineLayoutSnapshot,
    trackConfigs: TrackConfigMap,
    sidebarConfig: boolean | SidebarConfig | undefined,
    showRuler: boolean,
  ): void {
    if (sidebarConfig === false) {
      this.sidebarEl.style.display = 'none'
      return
    }
    this.sidebarEl.style.display = ''

    const resolvedConfig: SidebarConfig = typeof sidebarConfig === 'object' && sidebarConfig !== null
      ? sidebarConfig
      : {}
    if (typeof resolvedConfig.width === 'number' && resolvedConfig.width > 0) {
      this.sidebarEl.style.width = `${resolvedConfig.width}px`
    }
    else {
      this.sidebarEl.style.width = ''
    }

    this.headerEl.style.display = showRuler ? '' : 'none'
    this.bodyEl.style.paddingTop = `${layout.contentTop}px`
    this.bodyEl.style.paddingBottom = `${layout.contentBottom}px`

    const showActions = resolvedConfig.showTrackActions !== false
    const activeTrackIds = new Set<string>()
    const orderedRows: HTMLElement[] = []

    for (const trackLayout of layout.tracks) {
      const track = trackLayout.track
      activeTrackIds.add(track.id)

      const trackConfig = trackConfigs[track.type]
      const ctx: TrackHeaderContext = {
        track,
        trackIndex: trackLayout.trackIndex,
        height: trackLayout.height,
      }

      let record = this.mountedRows.get(track.id)
      if (!record) {
        const rowEl = document.createElement('div')
        rowEl.className = 'tk-track-label'

        const iconHost = document.createElement('div')
        iconHost.className = 'tk-track-icon'

        const controlsEl = document.createElement('div')
        controlsEl.className = 'tk-track-controls'

        rowEl.append(iconHost, controlsEl)
        record = {
          trackId: track.id,
          rowEl,
          iconHost,
          controlsEl,
        }
        this.mountedRows.set(track.id, record)
      }

      record.rowEl.style.height = `${trackLayout.height}px`
      record.rowEl.dataset.trackIndex = String(trackLayout.trackIndex)
      record.rowEl.dataset.trackId = track.id

      const nextSlot = trackConfig?.icon
      if (nextSlot !== record.slotRef) {
        record.slotHandle?.destroy?.()
        record.slotHandle = undefined
        record.iconHost.replaceChildren()
        record.slotRef = nextSlot
        if (nextSlot) {
          record.slotHandle = normalizeSlotRenderer(nextSlot).mount(record.iconHost, ctx) ?? undefined
        }
        else {
          record.iconHost.appendChild(createTrackTypeIcon(track.type))
        }
      }
      else if (record.slotRef) {
        record.slotHandle?.update?.(ctx)
      }
      else if (record.iconHost.childElementCount === 0) {
        record.iconHost.appendChild(createTrackTypeIcon(track.type))
      }

      record.controlsEl.style.display = showActions ? '' : 'none'
      if (showActions) {
        this.renderTrackActions(record.controlsEl, trackLayout.trackIndex, track.locked === true, track.visible === false, track.muted === true)
      }

      orderedRows.push(record.rowEl)
    }

    for (const [trackId, record] of this.mountedRows.entries()) {
      if (!activeTrackIds.has(trackId)) {
        record.slotHandle?.destroy?.()
        record.rowEl.remove()
        this.mountedRows.delete(trackId)
      }
    }

    this.bodyEl.replaceChildren(...orderedRows)
  }

  syncScroll(scrollTop: number): void {
    this.bodyEl.style.transform = `translateY(${-scrollTop}px)`
  }

  syncHeights(trackRowElements: readonly HTMLElement[]): void {
    const labels = Array.from(this.bodyEl.children) as HTMLElement[]
    labels.forEach((label, index) => {
      const row = trackRowElements[index]
      if (row && row.offsetHeight > 0) {
        label.style.height = `${row.offsetHeight}px`
      }
    })
  }

  destroy(): void {
    for (const record of this.mountedRows.values()) {
      record.slotHandle?.destroy?.()
    }
    this.mountedRows.clear()
    this.bodyEl.replaceChildren()
  }

  private renderTrackActions(
    controlsEl: HTMLElement,
    trackIndex: number,
    locked: boolean,
    hidden: boolean,
    muted: boolean,
  ): void {
    // aria-label is a stable name for the toggle; the pressed state is conveyed by aria-pressed.
    const actions: Array<{ command: 'locked' | 'visible' | 'muted', title: string, label: string, active: boolean }> = [
      { command: 'locked', title: locked ? '解锁' : '锁定', label: 'Lock track', active: locked },
      { command: 'visible', title: hidden ? '显示' : '隐藏', label: 'Hide track', active: hidden },
      { command: 'muted', title: muted ? '取消静音' : '静音', label: 'Mute track', active: muted },
    ]

    const buttons = actions.map((action) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'tk-track-toggle'
      button.dataset.trackCommand = action.command
      button.dataset.trackIndex = String(trackIndex)
      button.title = action.title
      button.setAttribute('aria-label', action.label)
      button.setAttribute('aria-pressed', action.active ? 'true' : 'false')
      if (action.active) {
        button.classList.add('is-active')
      }
      button.appendChild(createTrackActionIcon(action.command, action.active))
      return button
    })

    controlsEl.replaceChildren(...buttons)
  }
}
