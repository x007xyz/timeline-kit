import { cloneDocument, createTimelineEditor, type TimelineDocument } from '../src/index'

// Two editors on one page, each starting from its own copy of the same document.
// Used by tests/e2e/multi-instance.e2e.test.mjs to check shortcut scoping.
const demoDocument: TimelineDocument = {
  id: 'multi-doc',
  name: 'Multi-instance demo',
  fps: 24,
  tracks: [
    {
      id: 'video-1',
      type: 'image',
      name: 'Video 1',
      clips: [
        { id: 'intro', type: 'image', name: 'Intro', startMs: 0, endMs: 4500 },
        { id: 'main', type: 'image', name: 'Main', startMs: 4500, endMs: 9000 },
        { id: 'outro', type: 'image', name: 'Outro', startMs: 9000, endMs: 12000 },
      ],
    },
    {
      id: 'titles-1',
      type: 'text',
      name: 'Titles',
      clips: [
        { id: 'title', type: 'text', name: 'Title card', startMs: 500, endMs: 3000 },
      ],
    },
  ],
}

const hostA = document.querySelector<HTMLDivElement>('#editor-a')!
const hostB = document.querySelector<HTMLDivElement>('#editor-b')!

const editorA = createTimelineEditor(hostA, {
  document: cloneDocument(demoDocument),
  trackScale: 50,
  ui: { toolbar: true, sidebar: true, ruler: true, ariaLabel: 'Editor A' },
})

const editorB = createTimelineEditor(hostB, {
  document: cloneDocument(demoDocument),
  trackScale: 50,
  ui: { toolbar: true, sidebar: true, ruler: true, ariaLabel: 'Editor B' },
})

const editors = [editorA, editorB]

Object.assign(window, {
  __editors: editors,
  // Minimal hook so the shared e2e harness (which waits for getEditor) can drive this page.
  __TIMELINE_DEMO__: { getEditor: () => editorA, getEditors: () => editors },
})
