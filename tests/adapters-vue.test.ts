import assert from 'node:assert/strict'
import { after, afterEach, before, describe, it } from 'node:test'
import * as nodeTest from 'node:test'
import type { TimelineEditor as VanillaTimelineEditor } from '../src/editor/TimelineEditor'
import type { ClipRenderContext, TimelineDocument, TimelineEditorSnapshot, TimelineState } from '../src/index'
import { registerDomEnv, unregisterDomEnv } from './helpers/dom-env'
import type * as AdapterNamespace from '../adapters/vue/index'
import type * as ModelNamespace from '../src/model'

// Vue is loaded dynamically after happy-dom is registered, so the small slice
// of its runtime API used here is typed locally.
type AnyNode = unknown

interface RefLike<T> {
  value: T
}

interface AppLike {
  mount: (container: Element) => void
  unmount: () => void
}

interface VueLike {
  createApp: (component: { render: () => AnyNode }) => AppLike
  nextTick: () => Promise<void>
  h: (type: unknown, props?: unknown, children?: unknown) => AnyNode
  shallowRef: <T>(value: T) => RefLike<T>
  defineComponent: (options: {
    props: Record<string, unknown>
    setup: (props: { source: unknown }) => () => AnyNode
  }) => unknown
}

interface MockFn {
  (...args: any[]): any
  mock: {
    callCount: () => number
    calls: Array<{ arguments: any[] }>
  }
}

interface CompInstance {
  getEditor: () => VanillaTimelineEditor | null
  exec: (command: string, payload?: unknown) => boolean
  fitToView: () => number | null
  scrollToTime: (ms: number) => void
}

const { mock } = nodeTest as unknown as { mock: { fn: (impl?: (...args: any[]) => any) => MockFn } }

// The shimmed node:test typings omit the options overload; this is the runtime form used for known bugs.

type AdapterModule = typeof AdapterNamespace
type ModelModule = typeof ModelNamespace

let Vue: VueLike
let adapter: AdapterModule
let model: ModelModule

interface Mounted {
  app: AppLike
  container: HTMLElement
  unmounted: boolean
}

const mounted: Mounted[] = []

function clone(): TimelineDocument {
  return model.cloneDocument(model.demoDocument)
}

function allClipIds(doc: TimelineDocument): string[] {
  return doc.tracks.flatMap(track => track.clips.map(clip => clip.id))
}

async function mount(render: () => AnyNode): Promise<Mounted> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const app = Vue.createApp({ render })
  const entry: Mounted = { app, container, unmounted: false }
  mounted.push(entry)
  app.mount(container)
  await Vue.nextTick()
  return entry
}

function unmount(entry: Mounted): void {
  if (entry.unmounted) {
    return
  }
  entry.unmounted = true
  entry.app.unmount()
  entry.container.remove()
}

function queryClipNode(container: HTMLElement, clipId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`.tk-track-clip[data-clip-id="${clipId}"]`)
}

before(async () => {
  registerDomEnv()
  Vue = (await import('vue')) as unknown as VueLike
  adapter = await import('../adapters/vue/index')
  model = await import('../src/model')
})

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    unmount(entry)
  }
})

after(async () => {
  await unregisterDomEnv()
})

describe('Vue TimelineEditor adapter', () => {
  it('mounts the timeline DOM inside the host element and emits ready with the editor', async () => {
    const onReady = mock.fn()
    const doc = clone()
    const entry = await mount(() => Vue.h(adapter.TimelineEditor, { document: doc, onReady }))

    assert.equal(onReady.mock.callCount(), 1)
    const editor = onReady.mock.calls[0].arguments[0] as VanillaTimelineEditor
    const host = entry.container.firstElementChild as HTMLElement | null
    assert.ok(host, 'adapter host div is rendered')
    assert.ok(host.querySelector('.tk-track-clip'), 'timeline clip nodes are rendered inside the host')
    assert.equal(editor.getDocument().id, doc.id)
  })

  it('destroys the editor on unmount: removes its DOM and stops emitting events', async () => {
    const compRef = Vue.shallowRef<{ exec: (command: string, payload?: unknown) => boolean } | null>(null)
    const onReady = mock.fn()
    const onDocumentchange = mock.fn()
    const entry = await mount(() => Vue.h(adapter.TimelineEditor, {
      ref: compRef,
      document: clone(),
      onReady,
      onDocumentchange,
    }))
    const editor = onReady.mock.calls[0].arguments[0] as VanillaTimelineEditor

    compRef.value?.exec('selection:set', { clipId: 'clip-v1-open' })
    compRef.value?.exec('clip:delete')
    assert.equal(onDocumentchange.mock.callCount(), 1, 'events are wired while mounted')

    unmount(entry)
    assert.equal(entry.container.childElementCount, 0, 'no timeline DOM left behind')

    const callsBefore = onDocumentchange.mock.callCount()
    editor.setDocument(clone())
    assert.equal(onDocumentchange.mock.callCount(), callsBefore, 'no listener fires after unmount')
  })

  it('renders the clip scoped slot for each clip with clip and isSelected, updating in place on selection change', async () => {
    const compRef = Vue.shallowRef<CompInstance | null>(null)
    const clipSlot = (ctx: ClipRenderContext) => Vue.h(
      'span',
      {
        'data-testid': 'clip-slot',
        'data-clip-id': ctx.clip.id,
        'data-selected': String(ctx.isSelected),
      },
      ctx.clip.name,
    )
    const entry = await mount(() => Vue.h(
      adapter.TimelineEditor,
      { ref: compRef, document: clone() },
      { clip: clipSlot },
    ))
    await Vue.nextTick()

    const slots = entry.container.querySelectorAll<HTMLElement>('[data-testid="clip-slot"]')
    assert.ok(slots.length > 0, 'clip slots are rendered')
    for (const slot of slots) {
      const clipNode = slot.closest<HTMLElement>('.tk-track-clip')
      assert.ok(clipNode, 'slot is teleported into a clip node')
      assert.equal(clipNode.dataset.clipId, slot.dataset.clipId)
    }

    const target = queryClipNode(entry.container, 'clip-v1-open')?.querySelector<HTMLElement>('[data-testid="clip-slot"]')
    assert.ok(target, 'target clip slot exists')
    assert.equal(target.dataset.selected, 'false')
    const expectedName = model.demoDocument.tracks.flatMap(track => track.clips).find(clip => clip.id === 'clip-v1-open')?.name
    assert.equal(target.textContent, expectedName)

    compRef.value?.exec('selection:set', { clipId: 'clip-v1-open' })
    await Vue.nextTick()

    const updated = queryClipNode(entry.container, 'clip-v1-open')?.querySelector<HTMLElement>('[data-testid="clip-slot"]')
    assert.equal(updated, target, 'slot node is patched in place, not remounted')
    assert.equal(updated?.dataset.selected, 'true')
  })

  it('useTimelineSelector returns current state, updates on change, and stops subscribing after unmount', async () => {
    const doc = clone()
    const selector = mock.fn((state: TimelineState) => state.selection.clipId)
    const editorRef = Vue.shallowRef<VanillaTimelineEditor | null>(null)
    const showProbe = Vue.shallowRef(true)

    const Probe = Vue.defineComponent({
      props: { source: { type: Object, required: true } },
      setup(props) {
        const value = adapter.useTimelineSelector(
          props.source as Parameters<AdapterModule['useTimelineSelector']>[0],
          selector,
        )
        return () => Vue.h('span', { 'data-testid': 'probe', 'data-value': String(value.value) })
      },
    })

    const entry = await mount(() => Vue.h('div', [
      Vue.h(adapter.TimelineEditor, {
        document: doc,
        onReady: (instance: VanillaTimelineEditor) => {
          editorRef.value = instance
        },
      }),
      showProbe.value ? Vue.h(Probe, { source: editorRef }) : null,
    ]))
    await Vue.nextTick()

    const probe = () => entry.container.querySelector<HTMLElement>('[data-testid="probe"]')
    assert.equal(probe()?.dataset.value, 'null', 'initial state is read from the editor')

    editorRef.value?.exec('selection:set', { clipId: 'clip-v1-open' })
    await Vue.nextTick()
    assert.equal(probe()?.dataset.value, 'clip-v1-open', 'probe updates on state change')
    const callsWhileMounted = selector.mock.callCount()
    assert.ok(callsWhileMounted > 0)

    showProbe.value = false
    await Vue.nextTick()
    assert.equal(probe(), null)

    editorRef.value?.exec('selection:set', { clipId: 'clip-v0-photo' })
    await Vue.nextTick()
    assert.equal(selector.mock.callCount(), callsWhileMounted, 'selector is not evaluated after unmount')
  })

  it('applies a new document prop to the editor', async () => {
    const compRef = Vue.shallowRef<{ getEditor: () => VanillaTimelineEditor | null } | null>(null)
    const docRef = Vue.shallowRef<TimelineDocument>(clone())
    const entry = await mount(() => Vue.h(adapter.TimelineEditor, {
      ref: compRef,
      document: docRef.value,
    }))

    const next = clone()
    next.name = 'Swapped Project'
    next.tracks = next.tracks.map(track => ({
      ...track,
      clips: track.clips.filter(clip => clip.id !== 'clip-v0-photo'),
    }))
    docRef.value = next
    await Vue.nextTick()

    assert.equal(compRef.value?.getEditor()?.getDocument().name, 'Swapped Project')
    assert.equal(queryClipNode(entry.container, 'clip-v0-photo'), null, 'removed clip is no longer rendered')
  })

  it('emits documentchange and update:document after an edit command such as clip:delete', async () => {
    const compRef = Vue.shallowRef<{ exec: (command: string, payload?: unknown) => boolean } | null>(null)
    const onDocumentchange = mock.fn()
    const onUpdateDocument = mock.fn()
    await mount(() => Vue.h(adapter.TimelineEditor, {
      ref: compRef,
      document: clone(),
      onDocumentchange,
      'onUpdate:document': onUpdateDocument,
    }))

    compRef.value?.exec('selection:set', { clipId: 'clip-v1-open' })
    assert.equal(onDocumentchange.mock.callCount(), 0, 'selection alone does not change the document')

    const executed = compRef.value?.exec('clip:delete') ?? false
    assert.equal(executed, true)
    assert.equal(onDocumentchange.mock.callCount(), 1)
    assert.equal(onUpdateDocument.mock.callCount(), 1)

    const snapshot = onDocumentchange.mock.calls[0].arguments[0] as TimelineEditorSnapshot
    assert.equal(allClipIds(snapshot.document).includes('clip-v1-open'), false)
    assert.equal(onUpdateDocument.mock.calls[0].arguments[0], snapshot.document)
  })

  it('honours an onBeforeCommand hook supplied after mount', async () => {
    const doc = clone()
    const compRef = Vue.shallowRef<{ exec: (command: string, payload?: unknown) => boolean } | null>(null)
    const hookRef = Vue.shallowRef<unknown>(undefined)
    const entry = await mount(() => Vue.h(adapter.TimelineEditor, {
      ref: compRef,
      document: doc,
      onBeforeCommand: hookRef.value,
    }))

    const hook = mock.fn((command: { type: string }) => (command.type === 'clip:delete' ? false : undefined))
    hookRef.value = hook
    await Vue.nextTick()

    compRef.value?.exec('selection:set', { clipId: 'clip-v1-open' })
    const executed = compRef.value?.exec('clip:delete') ?? true

    assert.ok(hook.mock.callCount() > 0, 'late-supplied hook is called')
    assert.equal(executed, false, 'hook veto blocks clip:delete')
    assert.ok(queryClipNode(entry.container, 'clip-v1-open'), 'vetoed clip is still rendered')
  })

  it('exposes getEditor, exec, fitToView and scrollToTime through the component instance', async () => {
    const compRef = Vue.shallowRef<CompInstance | null>(null)
    await mount(() => Vue.h(adapter.TimelineEditor, { ref: compRef, document: clone() }))

    const handle = compRef.value
    assert.ok(handle, 'component instance is available through the template ref')
    const editor = handle.getEditor()
    assert.ok(editor, 'getEditor returns the vanilla editor')

    const scaleBefore = editor.getTrackScale()
    assert.equal(handle.exec('scale:zoom-in'), true)
    assert.notEqual(editor.getTrackScale(), scaleBefore)

    assert.equal(handle.exec('no-such-command'), false)

    // scrollToTime has no return value; it must not throw for an in-range time.
    handle.scrollToTime(2000)

    const fitted = handle.fitToView()
    assert.equal(typeof fitted, 'number', 'fitToView returns the fitted scale')
    assert.equal(editor.getTrackScale(), fitted)
  })
})
