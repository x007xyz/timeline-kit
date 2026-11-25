import { GlobalRegistrator } from '@happy-dom/global-registrator'

let registered = false

/**
 * Registers happy-dom globals (window, document, customElements, ...).
 * Must run before importing react-dom, vue or the adapters.
 */
export function registerDomEnv(): void {
  if (registered) {
    return
  }
  GlobalRegistrator.register()
  registered = true
}

export async function unregisterDomEnv(): Promise<void> {
  if (!registered) {
    return
  }
  await GlobalRegistrator.unregister()
  registered = false
}
