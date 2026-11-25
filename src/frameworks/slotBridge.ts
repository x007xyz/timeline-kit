import type { SlotRendererObject } from '../renderer/types'

export interface SlotPortalEntry<TCtx> {
  key: string
  host: HTMLElement
  context: TCtx
}

export interface SlotBridge<TCtx> {
  slot: SlotRendererObject<TCtx>
  getEntries: () => readonly SlotPortalEntry<TCtx>[]
  subscribe: (listener: () => void) => () => void
  clear: () => void
}

export function createSlotBridge<TCtx>(
  getKey: (ctx: TCtx) => string,
): SlotBridge<TCtx> {
  const entries = new Map<string, SlotPortalEntry<TCtx>>()
  const listeners = new Set<() => void>()
  let snapshot: readonly SlotPortalEntry<TCtx>[] = []

  const emit = () => {
    snapshot = Array.from(entries.values())
    listeners.forEach((listener) => {
      listener()
    })
  }

  const slot: SlotRendererObject<TCtx> = {
    mount(host, ctx) {
      const key = getKey(ctx)
      entries.set(key, { key, host, context: ctx })
      emit()

      return {
        update(nextCtx) {
          const nextKey = getKey(nextCtx)
          if (nextKey !== key) {
            const current = entries.get(key)
            if (current && current.host === host) {
              entries.delete(key)
            }
          }
          entries.set(nextKey, { key: nextKey, host, context: nextCtx })
          emit()
        },
        destroy() {
          const current = entries.get(key)
          if (current && current.host === host) {
            entries.delete(key)
            emit()
          }
        },
      }
    },
  }

  return {
    slot,
    getEntries() {
      return snapshot
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    clear() {
      if (entries.size === 0) {
        return
      }
      entries.clear()
      emit()
    },
  }
}
