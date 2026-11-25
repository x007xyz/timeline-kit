import assert from 'node:assert/strict'
import { after, afterEach, before, describe, it } from 'node:test'
import * as nodeTest from 'node:test'
import type { TimelineEditorRef } from '../adapters/react/index'
import type { TimelineEditor as VanillaTimelineEditor } from '../src/editor/TimelineEditor'
import type { ClipRenderContext, TimelineDocument, TimelineEditorSnapshot, TimelineState } from '../src/index'
import { registerDomEnv, unregisterDomEnv } from './helpers/dom-env'
import type * as AdapterNamespace from '../adapters/react/index'
import type * as ModelNamespace from '../src/model'

// The framework modules are loaded dynamically after happy-dom is registered,
// so the small slice of their runtime API used here is typed locally.
type AnyElement = unknown

interface ReactLike {
  act: (callback: () => void | Promise<void>) => Promise<void>
  createElement: (type: unknown, props?: unknown, ...children: unknown[]) => AnyElement
  Fragment: unknown
  useState: <T>(initial: T) => [T, (value: T) => void]
}

interface RootLike {
  render: (element: AnyElement) => void
  unmount: () => void
}

interface ReactDomClientLike {
  createRoot: (container: Element) => RootLike
}

interface MockFn {
  (...args: any[]): any
  mock: {
    callCount: () => number
    calls: Array<{ arguments: any[] }>
  }
}

interface ActGlobal {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const { mock } = nodeTest as unknown as { mock: { fn: (impl?: (...args: any[]) => any) => MockFn } }

type AdapterModule = typeof AdapterNamespace
type ModelModule = typeof ModelNamespace

let React: ReactLike
let reactDomClient: ReactDomClientLike
let adapter: AdapterModule
let model: ModelModule

interface Mounted {
  root: RootLike
  container: HTMLElement
  unmounted: boolean
}

const mounted: Mounted[] = []

function createRef<T>(): { current: T | null } {
  return { current: null }
}

function clone(): TimelineDocument {
  return model.cloneDocument(model.demoDocument)
}

function allClipIds(doc: TimelineDocument): string[] {
  return doc.tracks.flatMap(track => track.clips.map(clip => clip.id))
}

async function mount(element: AnyElement): Promise<Mounted> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = reactDomClient.createRoot(container)
  const entry: Mounted = { root, container, unmounted: false }
  mounted.push(entry)
  await React.act(async () => {
    root.render(element)
  })
  return entry
}

async function rerender(entry: Mounted, element: AnyElement): Promise<void> {
  await React.act(async () => {
    entry.root.render(element)
  })
}

async function unmount(entry: Mounted): Promise<void> {
  if (entry.unmounted) {
    return
  }
  entry.unmounted = true
  await React.act(async () => {
    entry.root.unmount()
  })
  entry.container.remove()
}

function queryClipNode(container: HTMLElement, clipId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`.tk-track-clip[data-clip-id="${clipId}"]`)
}

before(async () => {
  registerDomEnv()
  ;(globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT = true
  React = (await import('react')) as unknown as ReactLike
  reactDomClient = (await import('react-dom/client')) as unknown as ReactDomClientLike
  adapter = await import('../adapters/react/index')
  model = await import('../src/model')
})

afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    await unmount(entry)
  }
})

after(async () => {
  await unregisterDomEnv()
})

describe('React TimelineEditor adapter', () => {
  it('mounts the timeline DOM inside the host element and reports the editor through onReady', async () => {
    const onReady = mock.fn()
    const doc = clone()
    const entry = await mount(React.createElement(adapter.TimelineEditor, { document: doc, onReady }))

    assert.equal(onReady.mock.callCount(), 1)
    const editor = onReady.mock.calls[0].arguments[0] as VanillaTimelineEditor
    const host = entry.container.firstElementChild as HTMLElement | null
    assert.ok(host, 'adapter host div is rendered')
    assert.ok(host.querySelector('.tk-track-clip'), 'timeline clip nodes are rendered inside the host')
    assert.equal(editor.getDocument().id, doc.id)
  })

  it('destroys the editor on unmount: removes its DOM, clears the ref, and stops emitting events', async () => {
    const ref = createRef<TimelineEditorRef>()
    const onReady = mock.fn()
    const onDocumentChange = mock.fn()
    const entry = await mount(React.createElement(adapter.TimelineEditor, {
      ref,
      document: clone(),
      onReady,
      onDocumentChange,
    }))
    const editor = onReady.mock.calls[0].arguments[0] as VanillaTimelineEditor

    await React.act(async () => {
      ref.current?.exec('selection:set', { clipId: 'clip-v1-open' })
    })
    await React.act(async () => {
      ref.current?.exec('clip:delete')
    })
    assert.equal(onDocumentChange.mock.callCount(), 1, 'events are wired while mounted')

    await unmount(entry)
    assert.equal(entry.container.childElementCount, 0, 'no timeline DOM left behind')
    assert.equal(ref.current, null, 'imperative handle is cleared')

    const callsBefore = onDocumentChange.mock.callCount()
    editor.setDocument(clone())
    assert.equal(onDocumentChange.mock.callCount(), callsBefore, 'no listener fires after unmount')
  })

  it('renders renderClip output for each clip with clip and isSelected, updating in place on selection change', async () => {
    const ref = createRef<TimelineEditorRef>()
    const renderClip = (ctx: ClipRenderContext) => React.createElement(
      'span',
      {
        'data-testid': 'clip-slot',
        'data-clip-id': ctx.clip.id,
        'data-selected': String(ctx.isSelected),
      },
      ctx.clip.name,
    )
    const entry = await mount(React.createElement(adapter.TimelineEditor, {
      ref,
      document: clone(),
      renderClip,
    }))

    const slots = entry.container.querySelectorAll<HTMLElement>('[data-testid="clip-slot"]')
    assert.ok(slots.length > 0, 'custom clip slots are rendered')
    for (const slot of slots) {
      const clipNode = slot.closest<HTMLElement>('.tk-track-clip')
      assert.ok(clipNode, 'slot is portaled into a clip node')
      assert.equal(clipNode.dataset.clipId, slot.dataset.clipId)
    }

    const target = queryClipNode(entry.container, 'clip-v1-open')?.querySelector<HTMLElement>('[data-testid="clip-slot"]')
    assert.ok(target, 'target clip slot exists')
    assert.equal(target.dataset.selected, 'false')
    const expectedName = model.demoDocument.tracks.flatMap(track => track.clips).find(clip => clip.id === 'clip-v1-open')?.name
    assert.equal(target.textContent, expectedName)

    await React.act(async () => {
      ref.current?.exec('selection:set', { clipId: 'clip-v1-open' })
    })

    const updated = queryClipNode(entry.container, 'clip-v1-open')?.querySelector<HTMLElement>('[data-testid="clip-slot"]')
    assert.equal(updated, target, 'slot node is updated in place, not remounted')
    assert.equal(updated?.dataset.selected, 'true')
  })

  it('useTimelineSelector returns current state, updates on change, and stops subscribing after unmount', async () => {
    const doc = clone()
    const selector = mock.fn((state: TimelineState) => state.selection.clipId)
    let editor: VanillaTimelineEditor | null = null

    function Probe(props: { editor: VanillaTimelineEditor | null }): AnyElement {
      const value = adapter.useTimelineSelector(props.editor, selector)
      return React.createElement('span', { 'data-testid': 'probe', 'data-value': String(value) })
    }

    function Host(props: { showProbe: boolean }): AnyElement {
      const [current, setCurrent] = React.useState<VanillaTimelineEditor | null>(null)
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(adapter.TimelineEditor, {
          document: doc,
          onReady: (instance: VanillaTimelineEditor) => {
            editor = instance
            setCurrent(instance)
          },
        }),
        props.showProbe ? React.createElement(Probe, { editor: current }) : null,
      )
    }

    const entry = await mount(React.createElement(Host, { showProbe: true }))
    const probe = () => entry.container.querySelector<HTMLElement>('[data-testid="probe"]')
    assert.equal(probe()?.dataset.value, 'null', 'initial state is read from the editor')

    await React.act(async () => {
      editor?.exec('selection:set', { clipId: 'clip-v1-open' })
    })
    assert.equal(probe()?.dataset.value, 'clip-v1-open', 'probe updates on state change')
    const callsWhileMounted = selector.mock.callCount()
    assert.ok(callsWhileMounted > 0)

    await rerender(entry, React.createElement(Host, { showProbe: false }))
    assert.equal(probe(), null)

    await React.act(async () => {
      editor?.exec('selection:set', { clipId: 'clip-v0-photo' })
    })
    assert.equal(selector.mock.callCount(), callsWhileMounted, 'selector is not evaluated after unmount')
  })

  it('applies a new document prop to the editor', async () => {
    const ref = createRef<TimelineEditorRef>()
    const entry = await mount(React.createElement(adapter.TimelineEditor, { ref, document: clone() }))

    const next = clone()
    next.name = 'Swapped Project'
    next.tracks = next.tracks.map(track => ({
      ...track,
      clips: track.clips.filter(clip => clip.id !== 'clip-v0-photo'),
    }))
    await rerender(entry, React.createElement(adapter.TimelineEditor, { ref, document: next }))

    assert.equal(ref.current?.getEditor()?.getDocument().name, 'Swapped Project')
    assert.equal(queryClipNode(entry.container, 'clip-v0-photo'), null, 'removed clip is no longer rendered')
  })

  it('fires onDocumentChange after an edit command such as clip:delete', async () => {
    const ref = createRef<TimelineEditorRef>()
    const onDocumentChange = mock.fn()
    await mount(React.createElement(adapter.TimelineEditor, {
      ref,
      document: clone(),
      onDocumentChange,
    }))

    await React.act(async () => {
      ref.current?.exec('selection:set', { clipId: 'clip-v1-open' })
    })
    assert.equal(onDocumentChange.mock.callCount(), 0, 'selection alone does not change the document')

    let executed = false
    await React.act(async () => {
      executed = ref.current?.exec('clip:delete') ?? false
    })
    assert.equal(executed, true)
    assert.equal(onDocumentChange.mock.callCount(), 1)

    const snapshot = onDocumentChange.mock.calls[0].arguments[0] as TimelineEditorSnapshot
    assert.equal(allClipIds(snapshot.document).includes('clip-v1-open'), false)
  })

  it('honours an onBeforeCommand hook supplied after mount', async () => {
    const ref = createRef<TimelineEditorRef>()
    const doc = clone()
    const entry = await mount(React.createElement(adapter.TimelineEditor, { ref, document: doc }))

    const hook = mock.fn((command: { type: string }) => (command.type === 'clip:delete' ? false : undefined))
    await rerender(entry, React.createElement(adapter.TimelineEditor, { ref, document: doc, onBeforeCommand: hook }))

    await React.act(async () => {
      ref.current?.exec('selection:set', { clipId: 'clip-v1-open' })
    })
    let executed = true
    await React.act(async () => {
      executed = ref.current?.exec('clip:delete') ?? true
    })

    assert.ok(hook.mock.callCount() > 0, 'late-supplied hook is called')
    assert.equal(executed, false, 'hook veto blocks clip:delete')
    assert.ok(queryClipNode(entry.container, 'clip-v1-open'), 'vetoed clip is still rendered')
  })

  it('exposes getEditor, exec, fitToView and scrollToTime through the imperative ref', async () => {
    const ref = createRef<TimelineEditorRef>()
    await mount(React.createElement(adapter.TimelineEditor, { ref, document: clone() }))

    const handle = ref.current
    assert.ok(handle, 'ref is populated after mount')
    const editor = handle.getEditor()
    assert.ok(editor, 'getEditor returns the vanilla editor')

    const scaleBefore = editor.getTrackScale()
    let zoomed = false
    await React.act(async () => {
      zoomed = handle.exec('scale:zoom-in')
    })
    assert.equal(zoomed, true)
    assert.notEqual(editor.getTrackScale(), scaleBefore)

    assert.equal(handle.exec('no-such-command'), false)

    // scrollToTime has no return value; it must not throw for an in-range time.
    handle.scrollToTime(2000)

    const fitted = handle.fitToView()
    assert.equal(typeof fitted, 'number', 'fitToView returns the fitted scale')
    assert.equal(editor.getTrackScale(), fitted)
  })
})
