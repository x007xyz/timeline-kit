import { createClipDragPlugin } from './clipDragPlugin'
import { createClipTrimPlugin } from './clipTrimPlugin'
import { createPlayheadPlugin } from './playheadPlugin'
import { createSelectionPlugin } from './selectionPlugin'
import { createShortcutsPlugin, type ShortcutsPluginOptions } from './shortcutsPlugin'
import { clipEdgeSnapProvider, playheadSnapProvider } from './snapProviders'
import type { TimelinePlugin } from './types'
import { createWheelPlugin } from './wheelPlugin'

export * from './types'
export { InteractionManager, matchesKeyChord } from './interactionManager'
export { playheadSnapProvider, clipEdgeSnapProvider, createGridSnapProvider, type GridSnapProviderOptions } from './snapProviders'
export { createPlayheadPlugin } from './playheadPlugin'
export { createClipTrimPlugin } from './clipTrimPlugin'
export { createClipDragPlugin } from './clipDragPlugin'
export { createSelectionPlugin } from './selectionPlugin'
export { createWheelPlugin } from './wheelPlugin'
export { createShortcutsPlugin, DEFAULT_SHORTCUT_KEYMAP, type ShortcutsPluginOptions } from './shortcutsPlugin'
export { createMarqueeSelectPlugin } from './marqueeSelectPlugin'
export { createExternalDropPlugin, type ExternalDropItem, type ExternalDropPluginOptions } from './externalDropPlugin'

export interface DefaultPluginsOptions {
  shortcuts?: boolean | ShortcutsPluginOptions
}

export function createDefaultPlugins(options: DefaultPluginsOptions = {}): TimelinePlugin[] {
  const shortcutsOpts: ShortcutsPluginOptions = typeof options.shortcuts === 'boolean'
    ? { enabled: options.shortcuts }
    : (options.shortcuts ?? {})

  return [
    {
      name: 'builtin:snap-defaults',
      snapProviders: [playheadSnapProvider, clipEdgeSnapProvider],
    },
    createPlayheadPlugin(),
    createClipTrimPlugin(),
    createClipDragPlugin(),
    createSelectionPlugin(),
    createWheelPlugin(),
    createShortcutsPlugin(shortcutsOpts),
  ]
}
