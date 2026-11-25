import type {
  AfterCommandHook,
  BeforeCommandHook,
  CommandContext,
  CommandSpec,
  TimelineCommand,
} from './types'

export class CommandBus {
  private readonly context: CommandContext
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous payload types per command
  private readonly commands: Map<string, CommandSpec<any>>
  private readonly aliases: Map<string, string>
  private readonly beforeHooks: Set<BeforeCommandHook>
  private readonly afterHooks: Set<AfterCommandHook>

  constructor(context: CommandContext) {
    this.context = context
    this.commands = new Map()
    this.aliases = new Map()
    this.beforeHooks = new Set()
    this.afterHooks = new Set()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- public default kept for API compatibility
  register<TPayload = any>(type: string, spec: CommandSpec<TPayload>): () => void {
    this.commands.set(type, spec)
    return () => {
      if (this.commands.get(type) === spec) {
        this.commands.delete(type)
      }
    }
  }

  unregister(type: string): void {
    this.commands.delete(type)
  }

  registerAlias(alias: string, targetType: string): () => void {
    this.aliases.set(alias, targetType)
    return () => {
      if (this.aliases.get(alias) === targetType) {
        this.aliases.delete(alias)
      }
    }
  }

  resolveType(type: string): string {
    return this.aliases.get(type) ?? type
  }

  has(type: string): boolean {
    return this.commands.has(this.resolveType(type))
  }

  addBeforeHook(hook: BeforeCommandHook): () => void {
    this.beforeHooks.add(hook)
    return () => {
      this.beforeHooks.delete(hook)
    }
  }

  addAfterHook(hook: AfterCommandHook): () => void {
    this.afterHooks.add(hook)
    return () => {
      this.afterHooks.delete(hook)
    }
  }

  canExecute(type: string, payload?: unknown): boolean {
    const resolved = this.resolveType(type)
    const spec = this.commands.get(resolved)
    if (!spec) {
      return false
    }
    return spec.canExecute ? spec.canExecute(this.context, payload) : true
  }

  execute(type: string, payload?: unknown): boolean {
    let currentCommand: TimelineCommand = {
      type: this.resolveType(type),
      payload,
    }

    for (const hook of this.beforeHooks) {
      const outcome = hook(currentCommand, this.context)
      if (outcome === false) {
        this.afterHooks.forEach(after => after(currentCommand, false, this.context))
        return false
      }
      if (outcome && typeof outcome === 'object' && typeof outcome.type === 'string') {
        currentCommand = {
          type: this.resolveType(outcome.type),
          payload: outcome.payload,
        }
      }
    }

    const spec = this.commands.get(currentCommand.type)
    if (!spec) {
      this.afterHooks.forEach(after => after(currentCommand, false, this.context))
      return false
    }

    if (spec.canExecute && !spec.canExecute(this.context, currentCommand.payload)) {
      this.afterHooks.forEach(after => after(currentCommand, false, this.context))
      return false
    }

    const result = spec.execute(this.context, currentCommand.payload)
    const executed = result !== false
    this.afterHooks.forEach(after => after(currentCommand, executed, this.context))
    return executed
  }
}
