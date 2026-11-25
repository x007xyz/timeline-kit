// Minimal ambient types for Node built-ins used by tests (no @types/node).
// React/Vue are type-checked against their real published typings.

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
