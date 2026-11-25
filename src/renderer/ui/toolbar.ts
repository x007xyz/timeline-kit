import type { TimelineState } from '../../store/types'
import type { ToolbarConfig, ToolbarContext } from '../types'
import { createToolbarIcon } from './icons'

export const DEFAULT_TOOLS: ToolbarConfig[] = [
  { id: 'undo', sort: 1, position: 'left', command: 'undo', title: '撤销 (Ctrl/Cmd+Z)' },
  { id: 'redo', sort: 2, position: 'left', command: 'redo', title: '重做 (Ctrl+Y / Cmd+Shift+Z)' },
  { id: 'split', sort: 3, position: 'left', command: 'split', title: '分割 (Ctrl/Cmd+B)' },
  { id: 'delete', sort: 4, position: 'left', command: 'delete', title: '删除 (Delete/Backspace)' },
  { id: 'magnetSnap', sort: 5, position: 'right', command: 'magnet', title: '磁吸' },
  { id: 'fitToView', sort: 6, position: 'right', command: 'fit', title: '适应窗口' },
]

function appendToolbarContent(button: HTMLButtonElement, content: HTMLElement | string | null | undefined): void {
  if (content == null) {
    return
  }
  if (typeof content === 'string') {
    button.textContent = content
    return
  }
  button.appendChild(content)
}

export class ToolbarRenderer {
  private readonly host: HTMLElement
  private readonly buttons: Map<string, HTMLButtonElement>
  private slider: HTMLInputElement | null
  private lastToolsSignature: string

  constructor(host: HTMLElement) {
    this.host = host
    this.buttons = new Map()
    this.slider = null
    this.lastToolsSignature = ''
  }

  render(state: TimelineState, customTools: readonly ToolbarConfig[] | boolean | undefined): void {
    if (customTools === false) {
      this.host.style.display = 'none'
      return
    }
    this.host.style.display = ''

    const tools = this.resolveTools(Array.isArray(customTools) ? customTools : [])
    const signature = tools.map(tool => `${tool.id}:${tool.sort}:${tool.position}:${tool.command ?? ''}:${tool.title ?? ''}:${Boolean(tool.render)}`).join('|')
    const context: ToolbarContext = { snapshot: state }

    if (signature !== this.lastToolsSignature || this.buttons.size === 0) {
      this.rebuild(tools, context)
      this.lastToolsSignature = signature
    }
    else {
      this.updateStates(tools, context)
    }

    if (this.slider) {
      this.slider.value = String(state.trackScale)
    }
  }

  destroy(): void {
    this.buttons.clear()
    this.slider = null
    this.lastToolsSignature = ''
    this.host.replaceChildren()
  }

  private resolveTools(customTools: readonly ToolbarConfig[]): ToolbarConfig[] {
    const configMap = new Map<string, ToolbarConfig>()
    for (const tool of DEFAULT_TOOLS) {
      configMap.set(tool.id, tool)
    }
    for (const tool of customTools) {
      configMap.set(tool.id, { ...configMap.get(tool.id), ...tool })
    }
    return Array.from(configMap.values()).sort((a, b) => a.sort - b.sort)
  }

  private rebuild(tools: ToolbarConfig[], context: ToolbarContext): void {
    this.buttons.clear()
    const shell = document.createElement('div')
    shell.className = 'tk-toolbar-shell'

    const left = document.createElement('div')
    left.className = 'tk-toolbar-group is-left'
    const right = document.createElement('div')
    right.className = 'tk-toolbar-group is-right'

    for (const tool of tools) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'tk-toolbar-button'
      if (tool.command) {
        button.dataset.command = tool.command
      }
      if (tool.title) {
        button.title = tool.title
        button.setAttribute('aria-label', tool.title)
      }

      this.applyButtonState(button, tool, context)
      this.buttons.set(tool.id, button)

      if (tool.position === 'left') {
        left.appendChild(button)
      }
      else {
        right.appendChild(button)
      }
    }

    const zoom = document.createElement('div')
    zoom.className = 'tk-toolbar-zoom'

    const minus = document.createElement('button')
    minus.type = 'button'
    minus.className = 'tk-zoom-button'
    minus.dataset.command = 'zoom-out'
    minus.title = '缩小'
    minus.setAttribute('aria-label', '缩小')
    minus.appendChild(createToolbarIcon('zoom-out'))

    const slider = document.createElement('input')
    slider.className = 'tk-zoom-slider'
    slider.type = 'range'
    slider.min = '0'
    slider.max = '100'
    slider.step = '1'
    slider.value = String(context.snapshot.trackScale)
    slider.dataset.command = 'track-scale'
    slider.setAttribute('aria-label', 'Zoom')
    this.slider = slider

    const plus = document.createElement('button')
    plus.type = 'button'
    plus.className = 'tk-zoom-button'
    plus.dataset.command = 'zoom-in'
    plus.title = '放大'
    plus.setAttribute('aria-label', '放大')
    plus.appendChild(createToolbarIcon('zoom-in'))

    zoom.append(minus, slider, plus)
    right.appendChild(zoom)
    shell.append(left, right)
    this.host.replaceChildren(shell)
  }

  private updateStates(tools: ToolbarConfig[], context: ToolbarContext): void {
    for (const tool of tools) {
      const button = this.buttons.get(tool.id)
      if (!button) {
        continue
      }
      this.applyButtonState(button, tool, context)
    }
  }

  private applyButtonState(button: HTMLButtonElement, tool: ToolbarConfig, context: ToolbarContext): void {
    const isDisabled = tool.isDisabled?.(context)
      ?? (tool.id === 'undo' ? !context.snapshot.canUndo
        : tool.id === 'redo' ? !context.snapshot.canRedo
          : tool.id === 'split' || tool.id === 'delete' ? context.snapshot.selection.clipId == null
            : false)
    const isActive = tool.isActive?.(context)
      ?? (tool.id === 'magnetSnap' ? context.snapshot.isMagnetEnabled : false)

    button.disabled = isDisabled
    button.classList.toggle('is-active', isActive)
    if (tool.isActive !== undefined || tool.id === 'magnetSnap') {
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false')
    }

    if (tool.render) {
      button.replaceChildren()
      appendToolbarContent(button, tool.render(context))
    }
    else if (button.childElementCount === 0 && !button.textContent) {
      if (tool.label) {
        button.textContent = tool.label
      }
      else {
        button.appendChild(createToolbarIcon(tool.id))
      }
    }
  }
}
