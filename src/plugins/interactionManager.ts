import type { SnapProvider } from '../engine/snap'
import type {
  InteractionHandler,
  InteractionSession,
  KeyBinding,
  PluginContext,
  TimelineDropEvent,
  TimelinePlugin,
  TimelinePointerEvent,
  TimelineWheelEvent,
} from './types'

interface RegisteredPlugin {
  plugin: TimelinePlugin
  disposers: Array<() => void>
}

interface ParsedChord {
  mod: boolean
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
  key: string
}

function normalizeKeyName(key: string): string {
  const lower = key.toLowerCase()
  if (lower === ' ') {
    return 'space'
  }
  if (lower === 'esc') {
    return 'escape'
  }
  if (lower === 'del') {
    return 'delete'
  }
  return lower
}

function parseKeyChord(chord: string): ParsedChord {
  const parts = chord.split('+').map(part => part.trim().toLowerCase()).filter(Boolean)
  const parsed: ParsedChord = {
    mod: false,
    ctrl: false,
    meta: false,
    shift: false,
    alt: false,
    key: '',
  }

  for (const part of parts) {
    if (part === 'mod') {
      parsed.mod = true
    }
    else if (part === 'ctrl' || part === 'control') {
      parsed.ctrl = true
    }
    else if (part === 'meta' || part === 'cmd' || part === 'command') {
      parsed.meta = true
    }
    else if (part === 'shift') {
      parsed.shift = true
    }
    else if (part === 'alt' || part === 'option') {
      parsed.alt = true
    }
    else {
      parsed.key = normalizeKeyName(part)
    }
  }

  return parsed
}

function normalizeChordCanonical(chord: string): string {
  const parsed = parseKeyChord(chord)
  const tokens: string[] = []
  if (parsed.mod)
    tokens.push('mod')
  if (parsed.ctrl)
    tokens.push('ctrl')
  if (parsed.meta)
    tokens.push('meta')
  if (parsed.shift)
    tokens.push('shift')
  if (parsed.alt)
    tokens.push('alt')
  if (parsed.key)
    tokens.push(parsed.key)
  return tokens.join('+')
}

export function matchesKeyChord(event: KeyboardEvent, chord: string): boolean {
  const parsed = parseKeyChord(chord)
  if (!parsed.key || normalizeKeyName(event.key) !== parsed.key) {
    return false
  }

  if (parsed.mod) {
    if (!(event.metaKey || event.ctrlKey)) {
      return false
    }
  }
  else {
    if (Boolean(event.ctrlKey) !== parsed.ctrl) {
      return false
    }
    if (Boolean(event.metaKey) !== parsed.meta) {
      return false
    }
  }

  if (Boolean(event.shiftKey) !== parsed.shift) {
    return false
  }
  if (Boolean(event.altKey) !== parsed.alt) {
    return false
  }

  return true
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') {
    return false
  }
  const el = target as { tagName?: string, isContentEditable?: boolean }
  if (el.isContentEditable) {
    return true
  }
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
}

export class InteractionManager {
  private readonly context: PluginContext
  private readonly plugins: Map<string, RegisteredPlugin>
  private readonly handlers: InteractionHandler[]
  private readonly snapProviders: SnapProvider[]
  private readonly keymap: Map<string, KeyBinding>
  private activeSession: { handlerId: string, session: InteractionSession } | null
  private shortcutsEnabled: boolean

  constructor(context: Omit<PluginContext, 'getSnapProviders'>) {
    this.plugins = new Map()
    this.handlers = []
    this.snapProviders = []
    this.keymap = new Map()
    this.activeSession = null
    this.shortcutsEnabled = true
    this.context = {
      ...context,
      getSnapProviders: () => this.snapProviders,
    }
  }

  getContext(): PluginContext {
    return this.context
  }

  getSnapProviders(): readonly SnapProvider[] {
    return this.snapProviders
  }

  setShortcutsEnabled(enabled: boolean): void {
    this.shortcutsEnabled = enabled
  }

  isShortcutsEnabled(): boolean {
    return this.shortcutsEnabled
  }

  setKeyBinding(chord: string, binding: KeyBinding | null): void {
    const canonical = normalizeChordCanonical(chord)
    if (binding === null) {
      this.keymap.delete(canonical)
      return
    }
    this.keymap.set(canonical, binding)
  }

  use(plugin: TimelinePlugin): () => void {
    if (this.plugins.has(plugin.name)) {
      this.remove(plugin.name)
    }

    const disposers: Array<() => void> = []

    if (plugin.commands) {
      for (const [type, spec] of Object.entries(plugin.commands)) {
        disposers.push(this.context.commands.register(type, spec))
      }
    }

    if (plugin.interactions) {
      for (const handler of plugin.interactions) {
        this.handlers.push(handler)
        disposers.push(() => {
          const idx = this.handlers.indexOf(handler)
          if (idx !== -1) {
            this.handlers.splice(idx, 1)
          }
          if (this.activeSession?.handlerId === handler.id) {
            this.cancelActiveSession()
          }
        })
      }
      this.handlers.sort((left, right) => right.priority - left.priority)
    }

    if (plugin.snapProviders) {
      for (const provider of plugin.snapProviders) {
        this.snapProviders.push(provider)
        disposers.push(() => {
          const idx = this.snapProviders.indexOf(provider)
          if (idx !== -1) {
            this.snapProviders.splice(idx, 1)
          }
        })
      }
    }

    if (plugin.keymap) {
      for (const [chord, binding] of Object.entries(plugin.keymap)) {
        const canonical = normalizeChordCanonical(chord)
        const hadPrev = this.keymap.has(canonical)
        const prevBinding = this.keymap.get(canonical)
        this.setKeyBinding(chord, binding)
        disposers.push(() => {
          if (hadPrev && prevBinding !== undefined) {
            this.keymap.set(canonical, prevBinding)
          }
          else {
            this.keymap.delete(canonical)
          }
        })
      }
    }

    if (plugin.setup) {
      const cleanup = plugin.setup(this.context)
      if (typeof cleanup === 'function') {
        disposers.push(cleanup)
      }
    }

    this.plugins.set(plugin.name, { plugin, disposers })
    return () => {
      this.remove(plugin.name)
    }
  }

  remove(name: string): boolean {
    const entry = this.plugins.get(name)
    if (!entry) {
      return false
    }
    this.plugins.delete(name)
    for (let index = entry.disposers.length - 1; index >= 0; index -= 1) {
      entry.disposers[index]()
    }
    return true
  }

  hasPlugin(name: string): boolean {
    return this.plugins.has(name)
  }

  hasActiveSession(): boolean {
    return this.activeSession !== null
  }

  handlePointerDown(event: TimelinePointerEvent): boolean {
    if (this.activeSession) {
      this.cancelActiveSession()
    }

    for (const handler of this.handlers) {
      if (!handler.onPointerDown) {
        continue
      }
      const session = handler.onPointerDown(event, this.context)
      if (session) {
        this.activeSession = {
          handlerId: handler.id,
          session,
        }
        this.context.renderer.lockUserSelect?.()
        return true
      }
    }

    return false
  }

  handlePointerMove(event: TimelinePointerEvent): boolean {
    if (!this.activeSession) {
      return false
    }
    this.activeSession.session.onMove?.(event)
    return true
  }

  handlePointerUp(event: TimelinePointerEvent): boolean {
    if (!this.activeSession) {
      return false
    }
    const { session } = this.activeSession
    this.activeSession = null
    this.context.renderer.restoreUserSelect?.()
    session.onEnd?.(event)
    return true
  }

  cancelActiveSession(): boolean {
    if (!this.activeSession) {
      return false
    }
    const { session } = this.activeSession
    this.activeSession = null
    this.context.renderer.restoreUserSelect?.()
    session.onCancel?.()
    return true
  }

  handleWheel(event: TimelineWheelEvent): boolean {
    for (const handler of this.handlers) {
      if (handler.onWheel?.(event, this.context) === true) {
        return true
      }
    }
    return false
  }

  handleDragOver(event: TimelineDropEvent): boolean {
    for (const handler of this.handlers) {
      if (handler.onDragOver?.(event, this.context) === true) {
        return true
      }
    }
    return false
  }

  handleDragLeave(): void {
    for (const handler of this.handlers) {
      handler.onDragLeave?.(this.context)
    }
  }

  handleDrop(event: TimelineDropEvent): boolean {
    for (const handler of this.handlers) {
      if (handler.onDrop?.(event, this.context) === true) {
        return true
      }
    }
    return false
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (isEditableElement(event.target)) {
      return false
    }

    if (event.key === 'Escape' && this.activeSession) {
      this.cancelActiveSession()
      event.preventDefault()
      return true
    }

    for (const handler of this.handlers) {
      if (handler.onKeyDown?.(event, this.context) === true) {
        return true
      }
    }

    if (!this.shortcutsEnabled) {
      return false
    }

    const entries = Array.from(this.keymap.entries())
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [chord, binding] = entries[index]
      if (!matchesKeyChord(event, chord)) {
        continue
      }

      if (typeof binding === 'string') {
        event.preventDefault()
        this.context.commands.execute(binding)
        return true
      }

      const handled = binding(event, this.context)
      if (handled !== false) {
        event.preventDefault()
        return true
      }
    }

    return false
  }

  handleKeyUp(event: KeyboardEvent): boolean {
    for (const handler of this.handlers) {
      if (handler.onKeyUp?.(event, this.context) === true) {
        return true
      }
    }
    return false
  }

  destroy(): void {
    this.cancelActiveSession()
    const names = Array.from(this.plugins.keys())
    for (let index = names.length - 1; index >= 0; index -= 1) {
      this.remove(names[index])
    }
  }
}
