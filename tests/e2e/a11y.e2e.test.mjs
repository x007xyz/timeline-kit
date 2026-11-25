import assert from 'node:assert/strict'
import { after, afterEach, before, describe, it } from 'node:test'
import { launchCdpPage } from '../../scripts/cdp-client.mjs'

// Uses demo/multi.html (editor A only is asserted here) for a lightweight page without media decoding.
describe('timeline-kit accessibility E2E', () => {
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

  function readAttrs(selector, names) {
    return page.evaluate((sel, attrNames) => {
      const el = document.querySelector(sel)
      if (!el) {
        return null
      }
      const out = {}
      for (const name of attrNames) {
        out[name] = el.getAttribute(name)
      }
      return out
    }, selector, names)
  }

  function liveRegionText() {
    return page.evaluate(() => document.querySelector('#editor-a [role="status"]')?.textContent ?? null)
  }

  it('exposes an application root, labelled track groups, listbox lanes and option clips', async () => {
    const root = await readAttrs('#editor-a .tk-timeline-editor', ['role', 'aria-label', 'tabindex'])
    assert.deepEqual(root, { role: 'application', 'aria-label': 'Editor A', tabindex: '0' })

    const group = await readAttrs('#editor-a .tk-track-row[data-track-index="0"]', ['role', 'aria-label'])
    assert.deepEqual(group, { role: 'group', 'aria-label': 'Video 1' })

    const lane = await readAttrs('#editor-a .tk-track-row[data-track-index="0"] .tk-track-lane', ['role', 'aria-multiselectable', 'aria-label'])
    assert.deepEqual(lane, { role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': 'Video 1' })

    const clip = await readAttrs('#editor-a .tk-track-clip[data-clip-id="intro"]', ['role', 'aria-label', 'aria-selected'])
    assert.deepEqual(clip, { role: 'option', 'aria-label': 'Intro, 0:00.0 – 0:04.5', 'aria-selected': 'false' })

    const ruler = await readAttrs('#editor-a .tk-ruler-canvas', ['aria-hidden'])
    assert.deepEqual(ruler, { 'aria-hidden': 'true' })

    const status = await readAttrs('#editor-a [role="status"]', ['aria-live'])
    assert.deepEqual(status, { 'aria-live': 'polite' })

    const handle = await readAttrs('#editor-a .tk-playhead-handle', ['role', 'aria-valuemin', 'aria-valuenow', 'aria-valuetext'])
    assert.equal(handle.role, 'slider')
    assert.equal(handle['aria-valuemin'], '0')
    assert.equal(handle['aria-valuenow'], '0')
    assert.equal(handle['aria-valuetext'], '0:00.0')

    const toolbarLabels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#editor-a .tk-toolbar-button')).every(btn => Boolean(btn.getAttribute('aria-label'))),
    )
    assert.equal(toolbarLabels, true, 'Every toolbar button should have an accessible name')
  })

  it('updates aria-selected and the live region when the selection changes', async () => {
    await page.click('#editor-a .tk-track-clip[data-clip-id="intro"]')
    await page.waitForFunction(() => {
      const el = document.querySelector('#editor-a .tk-track-clip[data-clip-id="intro"]')
      return el?.getAttribute('aria-selected') === 'true'
    })
    assert.equal(await liveRegionText(), 'Selected: Intro')

    await page.click('#editor-a .tk-track-clip[data-clip-id="main"]')
    await page.waitForFunction(() => {
      const el = document.querySelector('#editor-a .tk-track-clip[data-clip-id="main"]')
      return el?.getAttribute('aria-selected') === 'true'
    })
    const intro = await readAttrs('#editor-a .tk-track-clip[data-clip-id="intro"]', ['aria-selected'])
    assert.equal(intro['aria-selected'], 'false', 'Previously selected clip should no longer be aria-selected')
    assert.equal(await liveRegionText(), 'Selected: Main')
  })

  it('updates the playhead slider values when the playhead moves', async () => {
    await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().setCurrentFrame(48))
    await page.waitForFunction(() => document.querySelector('#editor-a .tk-playhead-handle')?.getAttribute('aria-valuenow') === '48')
    const afterSet = await readAttrs('#editor-a .tk-playhead-handle', ['aria-valuenow', 'aria-valuetext'])
    assert.deepEqual(afterSet, { 'aria-valuenow': '48', 'aria-valuetext': '0:02.0' })

    // Focus is still inside editor A, so ArrowRight steps the playhead by one frame.
    await page.pressKey('ArrowRight')
    await page.waitForFunction(() => document.querySelector('#editor-a .tk-playhead-handle')?.getAttribute('aria-valuenow') === '49')
    const afterArrow = await readAttrs('#editor-a .tk-playhead-handle', ['aria-valuenow'])
    assert.equal(afterArrow['aria-valuenow'], '49')
  })

  it('exposes aria-pressed on track lock toggles and reflects the lock in the track label', async () => {
    const toggleSelector = '#editor-a .tk-timeline-sidebar .tk-track-toggle[data-track-command="locked"][data-track-index="1"]'
    const rowSelector = '#editor-a .tk-track-row[data-track-index="1"]'

    const before = await readAttrs(toggleSelector, ['aria-pressed', 'aria-label'])
    assert.equal(before['aria-pressed'], 'false')
    assert.equal(before['aria-label'], 'Lock track')
    assert.equal((await readAttrs(rowSelector, ['aria-label']))['aria-label'], 'Titles')

    await page.click(toggleSelector)
    await page.waitForFunction(sel => document.querySelector(sel)?.getAttribute('aria-pressed') === 'true', [toggleSelector])
    assert.equal((await readAttrs(toggleSelector, ['aria-pressed']))['aria-pressed'], 'true')
    assert.equal((await readAttrs(rowSelector, ['aria-label']))['aria-label'], 'Titles, locked')

    await page.click(toggleSelector)
    await page.waitForFunction(sel => document.querySelector(sel)?.getAttribute('aria-pressed') === 'false', [toggleSelector])
    assert.equal((await readAttrs(rowSelector, ['aria-label']))['aria-label'], 'Titles')
  })

  it('exposes aria-pressed on the magnet toolbar toggle', async () => {
    const magnetSelector = '#editor-a .tk-toolbar-button[data-command="magnet"]'
    const initial = (await readAttrs(magnetSelector, ['aria-pressed']))['aria-pressed']
    assert.ok(initial === 'true' || initial === 'false', `aria-pressed should be a boolean string, got ${initial}`)

    await page.click(magnetSelector)
    await page.waitForFunction(
      (sel, prev) => {
        const value = document.querySelector(sel)?.getAttribute('aria-pressed')
        return value !== null && value !== prev
      },
      [magnetSelector, initial],
    )
    const toggled = (await readAttrs(magnetSelector, ['aria-pressed']))['aria-pressed']
    assert.notEqual(toggled, initial)
  })
})
