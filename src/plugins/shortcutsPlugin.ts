import type { KeyBinding, TimelinePlugin } from './types'

export const DEFAULT_SHORTCUT_KEYMAP: Record<string, KeyBinding> = {
  'Mod+Z': 'history:undo',
  'Mod+Shift+Z': 'history:redo',
  'Ctrl+Y': 'history:redo',
  'Mod+B': 'clip:split',
  Delete: 'clip:delete',
  Backspace: 'clip:delete',
}

export interface ShortcutsPluginOptions {
  enabled?: boolean
  keymap?: Record<string, KeyBinding | null>
}

export function createShortcutsPlugin(options: ShortcutsPluginOptions = {}): TimelinePlugin {
  const mergedKeymap: Record<string, KeyBinding | null> = {
    ...DEFAULT_SHORTCUT_KEYMAP,
    ...(options.keymap ?? {}),
  }

  return {
    name: 'builtin:shortcuts',
    keymap: options.enabled === false ? {} : mergedKeymap,
  }
}
