declare module 'react' {
  export type ReactNode = any
  export type CSSProperties = Record<string, any>
  export interface Ref<T> {
    current: T | null
  }
  export function createElement(type: any, props?: any, ...children: any[]): any
  export function forwardRef<T, P = {}>(
    render: (props: P, ref: Ref<T> | ((instance: T | null) => void) | null) => ReactNode,
  ): any
  export function useEffect(effect: () => void | (() => void), deps?: readonly any[]): void
  export function useImperativeHandle<T>(ref: any, createHandle: () => T, deps?: readonly any[]): void
  export function useMemo<T>(factory: () => T, deps: readonly any[]): T
  export function useRef<T>(initialValue: T): { current: T }
  export function useState<T>(initialState: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void]
  export function useSyncExternalStore<T>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ): T
}

declare module 'react-dom' {
  export function createPortal(children: any, container: Element, key?: string | null): any
}

declare module 'vue' {
  export type PropType<T> = { new (...args: any[]): T } | (() => T)
  export interface Ref<T> {
    value: T
  }
  export interface ShallowRef<T> {
    value: T
  }
  export const Teleport: any
  export interface SetupContext {
    emit: (event: string, ...args: any[]) => void
    slots: Record<string, ((arg?: any) => any) | undefined>
    expose: (exposed: Record<string, any>) => void
  }
  export function defineComponent<Props = Record<string, any>>(options: {
    name?: string
    props?: any
    emits?: string[]
    setup?: (props: Props, ctx: SetupContext) => any
  }): any
  export function h(type: any, props?: any, children?: any): any
  export function onMounted(hook: () => void): void
  export function onBeforeUnmount(hook: () => void): void
  export function ref<T>(value: T): Ref<T>
  export function shallowRef<T>(value: T): ShallowRef<T>
  export function watch<T>(
    source: Ref<T> | ShallowRef<T> | (() => T),
    cb: (value: T, oldValue: T, onCleanup: (fn: () => void) => void) => void,
    options?: { immediate?: boolean, deep?: boolean },
  ): () => void
}

declare module 'node:test' {
  export function describe(name: string, fn: () => void | Promise<void>): void
  export function it(name: string, fn: () => void | Promise<void>): void
  export function before(fn: () => void | Promise<void>): void
  export function after(fn: () => void | Promise<void>): void
  export function beforeEach(fn: () => void | Promise<void>): void
  export function afterEach(fn: () => void | Promise<void>): void
}

declare module 'node:assert/strict' {
  const assert: {
    (value: unknown, message?: string): asserts value
    ok: (value: unknown, message?: string) => asserts value
    equal: <T>(actual: T, expected: T, message?: string) => void
    notEqual: <T>(actual: T, expected: T, message?: string) => void
    deepEqual: <T>(actual: T, expected: T, message?: string) => void
  }
  export default assert
}
