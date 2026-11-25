import assert from 'node:assert/strict'
import { after, afterEach, before, describe, it } from 'node:test'
import { MOD_CTRL, launchCdpPage } from '../../scripts/cdp-client.mjs'

// Two timeline editors on one page (demo/multi.html). Window-level keyboard shortcuts must be
// routed only to the editor that owns focus, or, when focus is on <body>, to the editor the
// user last pointer-downed in.
describe('multi-instance keyboard shortcut scoping E2E', () => {
  let page

  before(async () => {
    page = await launchCdpPage({
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      localRootDir: process.cwd(),
    })
    await page.goto(`${page.origin}/demo/multi.html`)
  })

  after(async () => {
    await page?.close()
  })

  afterEach(() => {
    assert.deepEqual(page.getErrors(), [], 'Expected zero uncaught page or console errors')
  })

  // Clip ids per track, read straight from the editor's document.
  function readClipIds(index) {
    return page.evaluate((i) => {
      return window.__editors[i].getDocument().tracks.map(track => track.clips.map(clip => clip.id))
    }, index)
  }

  function selectedIds(index) {
    return page.evaluate((i) => window.__editors[i].getState().selection.clipIds, index)
  }

  function clipSelector(pane, clipId) {
    return `#editor-${pane} .tk-track-clip[data-clip-id="${clipId}"]`
  }

  it('starts with identical documents in both editors', async () => {
    const a = await readClipIds(0)
    const b = await readClipIds(1)
    assert.deepEqual(a, [['intro', 'main', 'outro'], ['title']])
    assert.deepEqual(b, a)
  })

  it('routes Delete to the editor the user last clicked when focus is on body', async () => {
    // Select one clip in each editor.
    await page.click(clipSelector('a', 'intro'))
    await page.click(clipSelector('b', 'title'))
    assert.deepEqual(await selectedIds(0), ['intro'])
    assert.deepEqual(await selectedIds(1), ['title'])

    // Click into A (the last pointer-down), then move focus to <body>.
    await page.click(clipSelector('a', 'intro'))
    await page.evaluate(() => document.activeElement?.blur())
    const bBefore = await readClipIds(1)

    await page.pressKey('Delete')

    assert.deepEqual(await readClipIds(0), [['main', 'outro'], ['title']], 'Only editor A should delete its clip')
    assert.deepEqual(await readClipIds(1), bBefore, 'Editor B must not react to a Delete aimed at A')
  })

  it('routes Delete to editor B after the user clicks into B', async () => {
    const aBefore = await readClipIds(0)

    await page.click(clipSelector('b', 'title'))
    await page.evaluate(() => document.activeElement?.blur())

    await page.pressKey('Delete')

    // The default `removeEmptyTracks` policy also drops the "Titles" track once its only clip is deleted.
    assert.deepEqual(await readClipIds(1), [['intro', 'main', 'outro']], 'Only editor B should delete its clip')
    assert.deepEqual(await readClipIds(0), aBefore, 'Editor A must be unchanged when B handles Delete')
  })

  it('scopes Ctrl+Z to the editor that has focus inside its root', async () => {
    const bBeforeUndo = await readClipIds(1)

    // Clicking a clip in A moves focus inside A's root; the shortcut is then sent with focus there.
    await page.click(clipSelector('a', 'main'))
    const focusInsideA = await page.evaluate(() => {
      const root = document.querySelector('#editor-a .tk-timeline-editor')
      return Boolean(root && document.activeElement && root.contains(document.activeElement))
    })
    assert.equal(focusInsideA, true, 'Focus should be inside editor A before Ctrl+Z')

    await page.pressKey('z', MOD_CTRL)

    assert.deepEqual(await readClipIds(0), [['intro', 'main', 'outro'], ['title']], 'Ctrl+Z inside A should undo A\'s last delete')
    assert.deepEqual(await readClipIds(1), bBeforeUndo, 'Ctrl+Z inside A must not undo B\'s delete')
  })
})
