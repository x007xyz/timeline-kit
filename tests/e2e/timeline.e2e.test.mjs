import assert from 'node:assert/strict'
import { after, afterEach, before, describe, it } from 'node:test'
import { MOD_CTRL, MOD_SHIFT, launchCdpPage } from '../../scripts/cdp-client.mjs'

describe('timeline-kit real Chromium E2E', () => {
  let page

  before(async () => {
    page = await launchCdpPage({
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
      localRootDir: process.cwd(),
    })
    await page.goto(`${page.origin}/demo/index.html`)
  })

  after(async () => {
    await page?.close()
  })

  afterEach(() => {
    assert.deepEqual(page.getErrors(), [], 'Expected zero uncaught page or console errors')
  })

  async function switchScenario(id) {
    page.clearErrors()
    await page.evaluate((scenarioId) => {
      window.__TIMELINE_DEMO__.switchScenario(scenarioId)
    }, id)
    await page.waitForFunction(
      expected => window.__TIMELINE_DEMO__?.getScenario?.() === expected && Boolean(document.querySelector('.tk-ruler-canvas')),
      [id],
    )
    await new Promise(r => setTimeout(r, 40))
  }

  async function waitForDecodedCanvas(selector, expectedState = 'true', timeoutMs = 8000) {
    await page.waitForFunction(
      (sel, expected) => {
        const el = document.querySelector(sel)
        return Boolean(el && el.dataset.decoder === 'mediabunny' && el.dataset.decoded === expected)
      },
      [selector, expectedState],
      timeoutMs,
    )
  }

  async function getCanvasDigest(selector) {
    return page.evaluate((sel) => {
      const canvas = document.querySelector(sel)
      if (!canvas)
        return null
      const ctx = canvas.getContext('2d')
      const { width, height } = canvas
      if (!ctx || width <= 0 || height <= 0)
        return null
      const data = ctx.getImageData(0, 0, width, height).data
      const parts = [`${width}x${height}`]
      const step = Math.max(1, Math.floor((width * height) / 400))
      for (let i = 0; i < width * height; i += step) {
        const o = i * 4
        parts.push(`${data[o]},${data[o + 1]},${data[o + 2]}`)
      }
      return parts.join(';')
    }, selector)
  }

  async function getCanvasStats(selector) {
    return page.evaluate((sel) => {
      const canvas = document.querySelector(sel)
      if (!canvas)
        return null
      const ctx = canvas.getContext('2d')
      const { width, height } = canvas
      if (!ctx || width <= 0 || height <= 0)
        return { width, height, distinctColors: 0, nonTransparent: 0, sampleBg: null }

      const data = ctx.getImageData(0, 0, width, height).data
      const colors = new Set()
      let nonTransparent = 0
      const step = Math.max(1, Math.floor((width * height) / 2500))
      for (let i = 0; i < width * height; i += step) {
        const offset = i * 4
        const r = data[offset]
        const g = data[offset + 1]
        const b = data[offset + 2]
        const a = data[offset + 3]
        if (a > 0) {
          nonTransparent += 1
        }
        colors.add(`${r},${g},${b},${a}`)
      }

      const bgOffset = (Math.floor(height * 0.8) * width + Math.min(width - 1, 5)) * 4
      return {
        width,
        height,
        distinctColors: colors.size,
        nonTransparent,
        sampleBg: `${data[bgOffset]},${data[bgOffset + 1]},${data[bgOffset + 2]}`,
      }
    }, selector)
  }

  it('1. renders full-studio with Canvas ruler, Mediabunny video filmstrip & preview, audio waveforms, loaded images, and fancy text presets', async () => {
    await switchScenario('full-studio')

    await waitForDecodedCanvas('.tk-track-clip[data-clip-id="vid-opening"] canvas[data-media-role="filmstrip"]', 'true')
    await waitForDecodedCanvas('.tk-track-clip[data-clip-id="vid-opening"] canvas[data-media-role="waveform"]', 'true')
    await waitForDecodedCanvas('.tk-track-clip[data-clip-id="aud-bgm-main"] canvas[data-media-role="waveform"]', 'true')
    await waitForDecodedCanvas('canvas.tk-preview-canvas', 'true')

    const rulerStats = await getCanvasStats('canvas.tk-ruler-canvas')
    assert.ok(rulerStats && rulerStats.width > 300)
    assert.ok(rulerStats.distinctColors >= 2, `Ruler canvas should have ticks & text, got ${rulerStats.distinctColors} colors`)

    const filmstripStats = await getCanvasStats('.tk-track-clip[data-clip-id="vid-opening"] canvas[data-media-role="filmstrip"]')
    assert.ok(filmstripStats && filmstripStats.width > 50)
    assert.ok(filmstripStats.distinctColors >= 8, `Video filmstrip should render multi-color thumbnails via Mediabunny, got ${filmstripStats.distinctColors}`)

    const previewStats = await getCanvasStats('canvas.tk-preview-canvas')
    assert.ok(previewStats && previewStats.width > 100)
    assert.ok(previewStats.distinctColors >= 8, `Preview canvas should render decoded video frame via Mediabunny, got ${previewStats.distinctColors}`)

    const videoWaveStats = await getCanvasStats('.tk-track-clip[data-clip-id="vid-opening"] canvas[data-media-role="waveform"]')
    assert.ok(videoWaveStats && videoWaveStats.nonTransparent > 5)

    const audioWaveStats = await getCanvasStats('.tk-track-clip[data-clip-id="aud-bgm-main"] canvas[data-media-role="waveform"]')
    assert.ok(audioWaveStats && audioWaveStats.distinctColors >= 2, 'Audio clip should render real Mediabunny waveform bars')

    await page.waitForFunction(() => {
      const imgs = Array.from(document.querySelectorAll('.tk-image-clip-thumb'))
      return imgs.length >= 2 && imgs.every(img => img.complete && img.naturalWidth > 0)
    })

    const imgState = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('.tk-image-clip-thumb'))
      return imgs.map(img => ({ complete: img.complete, width: img.naturalWidth, src: img.getAttribute('src') || '' }))
    })
    assert.ok(imgState.length >= 2)
    assert.ok(imgState.every(item => item.complete && item.width > 0 && item.src.includes('.jpg')), 'All real JPG image thumbnails should be loaded')

    const fancyPresets = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.tk-fancy-clip')).map(el => el.dataset.preset),
    )
    assert.ok(fancyPresets.includes('neon'))
    assert.ok(fancyPresets.includes('variety'))
    assert.ok(fancyPresets.includes('subtitle'))
  })

  it('2. scrubs playhead via ruler click, handle drag, and arrow keys while updating preview without remounting custom slots', async () => {
    await switchScenario('full-studio')
    await waitForDecodedCanvas('canvas.tk-preview-canvas', 'true')
    const beforeSourceSec = await page.evaluate(() => document.querySelector('canvas.tk-preview-canvas')?.dataset.sourceSec)

    const statsBefore = await page.evaluate(() => window.__TIMELINE_DEMO__.getSlotLifecycleStats())
    const rulerBox = await page.getBox('.tk-timeline-ruler')
    await page.clickPoint(rulerBox.x + 170, rulerBox.cy) // ~160px into track => 4s => 96 frames

    const afterRulerFrame = await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getCurrentFrame())
    assert.ok(afterRulerFrame > 60 && afterRulerFrame < 130, `Expected frame near 96, got ${afterRulerFrame}`)

    // Drag playhead handle further right
    const handleBox = await page.getBox('.tk-playhead-handle')
    await page.drag({ x: handleBox.cx, y: handleBox.cy }, { x: handleBox.cx + 80, y: handleBox.cy }, 8)
    const afterDragFrame = await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getCurrentFrame())
    assert.ok(afterDragFrame > afterRulerFrame + 20, `Expected playhead drag to advance frame from ${afterRulerFrame}, got ${afterDragFrame}`)

    // Step frame with ArrowRight / ArrowLeft
    await page.pressKey('ArrowRight')
    const afterArrowRight = await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getCurrentFrame())
    assert.equal(afterArrowRight, afterDragFrame + 1)

    await page.pressKey('ArrowLeft')
    const afterArrowLeft = await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getCurrentFrame())
    assert.equal(afterArrowLeft, afterDragFrame)

    await waitForDecodedCanvas('canvas.tk-preview-canvas', 'true')
    const afterSourceSec = await page.evaluate(() => document.querySelector('canvas.tk-preview-canvas')?.dataset.sourceSec)
    assert.notEqual(afterSourceSec, beforeSourceSec, 'Preview canvas sourceSec should update when scrubbing playhead')

    // Verify dirty-channel playhead updates never destroyed or remounted custom clip slots
    const statsAfter = await page.evaluate(() => window.__TIMELINE_DEMO__.getSlotLifecycleStats())
    assert.equal(statsAfter.mounts, statsBefore.mounts, 'Playhead scrubbing must not remount custom clip slots')
    assert.equal(statsAfter.destroys, statsBefore.destroys)
  })

  it('3. supports single select, Ctrl multi-select, and marquee drag selection skipping locked tracks', async () => {
    await switchScenario('fancy-text-graphics')

    // Click first fancy text clip
    await page.click('.tk-track-clip[data-clip-id="gfx-neon"]')
    let selected = await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getState().selection.clipIds)
    assert.deepEqual(selected, ['gfx-neon'])

    // Ctrl+Click second clip for multi-select
    await page.click('.tk-track-clip[data-clip-id="gfx-gradient"]', { modifiers: MOD_CTRL })
    selected = await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getState().selection.clipIds)
    assert.deepEqual(selected.sort(), ['gfx-gradient', 'gfx-neon'])

    // Marquee drag across tracks (starting in open empty space at x+330 on track 0, dragging left-down across tracks)
    const track1Row = await page.getBox('.tk-track-row[data-track-index="0"]')
    const track3Row = await page.getBox('.tk-track-row[data-track-index="2"]')
    await page.drag(
      { x: track1Row.x + 330, y: track1Row.y + 8 },
      { x: track1Row.x + 120, y: track3Row.y + track3Row.height - 6 },
      10,
    )

    selected = await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getState().selection.clipIds)
    assert.ok(selected.includes('gfx-gradient'), 'Marquee should include unlocked gfx-gradient')
    assert.ok(selected.includes('gfx-variety'), 'Marquee should include unlocked gfx-variety')
    assert.equal(selected.includes('gfx-logo-locked'), false, 'Marquee must skip locked track clips')
  })

  it('4. drags clips across time, creates new track on drop above, and cancels mid-drag on Escape', async () => {
    await switchScenario('full-studio')

    const clipBox = await page.getBox('.tk-track-clip[data-clip-id="txt-neon-1"]')
    // Drag right by +20px (~ +500ms, stays before txt-variety-2 at 4500ms) within same track
    await page.drag({ x: clipBox.cx, y: clipBox.cy }, { x: clipBox.cx + 20, y: clipBox.cy }, 10)
    let doc = await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getDocument())
    let movedClip = doc.tracks[0].clips.find(c => c.id === 'txt-neon-1')
    assert.ok(movedClip && movedClip.startMs >= 800, `Expected clip to move right from 500ms, got ${movedClip?.startMs}`)

    // Start dragging again, do not release, press Escape -> must cancel cleanly
    const clipBox2 = await page.getBox('.tk-track-clip[data-clip-id="txt-neon-1"]')
    const startBeforeEsc = movedClip.startMs
    await page.drag(
      { x: clipBox2.cx, y: clipBox2.cy },
      { x: clipBox2.cx + 60, y: clipBox2.cy },
      6,
      { release: false },
    )
    await page.pressKey('Escape')
    await page.mouseUp(clipBox2.cx + 60, clipBox2.cy)

    doc = await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getDocument())
    movedClip = doc.tracks[0].clips.find(c => c.id === 'txt-neon-1')
    assert.equal(movedClip.startMs, startBeforeEsc, 'Escape must cancel drag without mutating startMs')

    // Drag clip vertically above first track to create a new track
    const initialTrackCount = doc.tracks.length
    const track0Box = await page.getBox('.tk-track-row[data-track-index="0"]')
    const neonBox = await page.getBox('.tk-track-clip[data-clip-id="txt-neon-1"]')
    await page.drag(
      { x: neonBox.cx, y: neonBox.cy },
      { x: neonBox.cx, y: track0Box.y - 12 },
      12,
    )
    doc = await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getDocument())
    assert.equal(doc.tracks.length, initialTrackCount + 1, 'Dropping above tracks should create a new track')
  })

  it('5. trims left and right clip edges within media bounds and cancels mid-trim on Escape', async () => {
    await switchScenario('full-studio')

    // Select vid-cyber so trim handles are clearly visible, then drag left handle right by +40px (~ +1000ms)
    await page.click('.tk-track-clip[data-clip-id="vid-cyber"]')
    const leftHandle = await page.getBox('.tk-track-clip[data-clip-id="vid-cyber"] .tk-track-clip-handle.is-left')
    await page.drag({ x: leftHandle.cx, y: leftHandle.cy }, { x: leftHandle.cx + 40, y: leftHandle.cy }, 8)

    let vidCyber = await page.evaluate(() => {
      const d = window.__TIMELINE_DEMO__.getEditor().getDocument()
      return d.tracks.flatMap(t => t.clips).find(c => c.id === 'vid-cyber')
    })
    assert.ok(vidCyber.startMs > 5800 && vidCyber.startMs < 6600, `Expected trimmed start near 6200ms, got ${vidCyber.startMs}`)
    assert.ok(vidCyber.trim.startMs > 600, `Media trim.startMs should advance proportionally, got ${vidCyber.trim.startMs}`)

    // Drag right handle left by -40px (~ -1000ms)
    const rightHandle = await page.getBox('.tk-track-clip[data-clip-id="vid-cyber"] .tk-track-clip-handle.is-right')
    const endBefore = vidCyber.endMs
    await page.drag({ x: rightHandle.cx, y: rightHandle.cy }, { x: rightHandle.cx - 40, y: rightHandle.cy }, 8)

    vidCyber = await page.evaluate(() => {
      const d = window.__TIMELINE_DEMO__.getEditor().getDocument()
      return d.tracks.flatMap(t => t.clips).find(c => c.id === 'vid-cyber')
    })
    assert.ok(vidCyber.endMs < endBefore - 500, `Expected endMs to shrink from ${endBefore}, got ${vidCyber.endMs}`)

    // Start trim and press Escape -> must not commit
    const endBeforeEsc = vidCyber.endMs
    const rightHandle2 = await page.getBox('.tk-track-clip[data-clip-id="vid-cyber"] .tk-track-clip-handle.is-right')
    await page.drag(
      { x: rightHandle2.cx, y: rightHandle2.cy },
      { x: rightHandle2.cx - 50, y: rightHandle2.cy },
      6,
      { release: false },
    )
    await page.pressKey('Escape')
    await page.mouseUp(rightHandle2.cx - 50, rightHandle2.cy)

    vidCyber = await page.evaluate(() => {
      const d = window.__TIMELINE_DEMO__.getEditor().getDocument()
      return d.tracks.flatMap(t => t.clips).find(c => c.id === 'vid-cyber')
    })
    assert.equal(vidCyber.endMs, endBeforeEsc, 'Escape must cancel trim')
  })

  it('6. splits, deletes, undoes/redoes via toolbar and shortcuts, and toggles track lock/hide/mute', async () => {
    await switchScenario('full-studio')

    // Select vid-opening (0..4500ms) and place playhead at frame 48 (2000ms)
    await page.click('.tk-track-clip[data-clip-id="vid-opening"]')
    await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().setCurrentFrame(48))

    // Split via shortcut Ctrl+B
    await page.pressKey('b', MOD_CTRL)
    let videoTrackClips = await page.evaluate(() => {
      const d = window.__TIMELINE_DEMO__.getEditor().getDocument()
      return d.tracks.find(t => t.id === 'track-main-video').clips
    })
    assert.equal(videoTrackClips.length, 3, 'Split should turn 2 video clips into 3')
    assert.equal(videoTrackClips[0].endMs, 2000)
    assert.equal(videoTrackClips[1].startMs, 2000)

    // Delete via toolbar delete button (testing focus retention so subsequent Ctrl+Z still works!)
    await page.click('.tk-toolbar-button[data-command="delete"]')
    videoTrackClips = await page.evaluate(() => {
      const d = window.__TIMELINE_DEMO__.getEditor().getDocument()
      return d.tracks.find(t => t.id === 'track-main-video').clips
    })
    assert.equal(videoTrackClips.length, 2, 'Toolbar delete should remove selected split half')

    // Immediate Ctrl+Z Undo (no refocus needed!)
    await page.pressKey('z', MOD_CTRL)
    videoTrackClips = await page.evaluate(() => {
      const d = window.__TIMELINE_DEMO__.getEditor().getDocument()
      return d.tracks.find(t => t.id === 'track-main-video').clips
    })
    assert.equal(videoTrackClips.length, 3, 'Ctrl+Z after toolbar delete should undo cleanly')

    // Ctrl+Shift+Z Redo
    await page.pressKey('z', MOD_CTRL | MOD_SHIFT)
    videoTrackClips = await page.evaluate(() => {
      const d = window.__TIMELINE_DEMO__.getEditor().getDocument()
      return d.tracks.find(t => t.id === 'track-main-video').clips
    })
    assert.equal(videoTrackClips.length, 2, 'Ctrl+Shift+Z should redo delete')

    // Sidebar track toggles: Lock, Visible, Mute
    await page.click('.tk-track-label[data-track-index="0"] .tk-track-toggle[data-track-command="locked"]')
    const lockedOverlayExists = await page.evaluate(() => Boolean(document.querySelector('.tk-track-row[data-track-index="0"] .tk-track-overlay.is-locked')))
    assert.equal(lockedOverlayExists, true)

    await page.click('.tk-track-label[data-track-index="1"] .tk-track-toggle[data-track-command="visible"]')
    const hiddenOverlayExists = await page.evaluate(() => Boolean(document.querySelector('.tk-track-row[data-track-index="1"] .tk-track-overlay.is-hidden')))
    assert.equal(hiddenOverlayExists, true)

    await page.click('.tk-track-label[data-track-index="3"] .tk-track-toggle[data-track-command="muted"]')
    const mutedOverlayExists = await page.evaluate(() => Boolean(document.querySelector('.tk-track-row[data-track-index="3"] .tk-track-overlay.is-muted')))
    assert.equal(mutedOverlayExists, true)
  })

  it('7. enables magnet mode to pack main track seamlessly and reorder clips on drag', async () => {
    await switchScenario('full-studio')

    // Initially vid-opening is 0..4500 and vid-cyber is 5200..10200 (700ms gap, 5000ms duration)
    await page.click('.tk-toolbar-button[data-command="magnet"]')
    let mainClips = await page.evaluate(() => {
      const d = window.__TIMELINE_DEMO__.getEditor().getDocument()
      return d.tracks.find(t => t.id === 'track-main-video').clips
    })
    assert.equal(mainClips[0].startMs, 0)
    assert.equal(mainClips[0].endMs, 4500)
    assert.equal(mainClips[1].startMs, 4500, 'Magnet toggle should close gap on main track')
    assert.equal(mainClips[1].endMs, 9500)

    // Drag second clip (vid-cyber) to the front of vid-opening
    const cyberBox = await page.getBox('.tk-track-clip[data-clip-id="vid-cyber"]')
    const openBox = await page.getBox('.tk-track-clip[data-clip-id="vid-opening"]')
    await page.drag({ x: cyberBox.cx, y: cyberBox.cy }, { x: openBox.x + 15, y: openBox.cy }, 12)

    mainClips = await page.evaluate(() => {
      const d = window.__TIMELINE_DEMO__.getEditor().getDocument()
      return d.tracks.find(t => t.id === 'track-main-video').clips
    })
    assert.equal(mainClips[0].id, 'vid-cyber')
    assert.equal(mainClips[0].startMs, 0)
    assert.equal(mainClips[1].id, 'vid-opening')
    assert.equal(mainClips[1].startMs, 5000)
  })

  it('8. handles cursor-anchored Ctrl+Wheel zoom, settle version increment, and zoom/fit buttons', async () => {
    await switchScenario('full-studio')

    const initialScale = await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getTrackScale())
    const viewportBox = await page.getBox('.tk-tracks-viewport')

    await page.wheel(viewportBox.cx, viewportBox.cy, 0, -120, MOD_CTRL)
    const zoomedScale = await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getTrackScale())
    assert.ok(zoomedScale > initialScale, `Expected Ctrl+Wheel zoom in from ${initialScale}, got ${zoomedScale}`)

    await page.waitForFunction(
      () => window.__TIMELINE_DEMO__.getEditor().getState().renderHints.settleVersion >= 1,
      [],
      2000,
    )

    await page.click('.tk-zoom-button[data-command="zoom-out"]')
    const afterOutScale = await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getTrackScale())
    assert.equal(afterOutScale, zoomedScale - 10)

    await page.click('.tk-toolbar-button[data-command="fit"]')
    const afterFitScale = await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getTrackScale())
    assert.ok(afterFitScale >= 0 && afterFitScale <= 100)
  })

  it('9. renders 4-track podcast Mediabunny audio waveforms and snaps to 500ms grid', async () => {
    await switchScenario('podcast-audio')

    await page.waitForFunction(() => {
      const nodes = Array.from(document.querySelectorAll('canvas[data-media-role="waveform"]'))
      return nodes.length === 5 && nodes.every(el => el.dataset.decoder === 'mediabunny' && el.dataset.decoded === 'true')
    }, [], 8000)

    const waveCanvases = await page.evaluate(() =>
      Array.from(document.querySelectorAll('canvas[data-media-role="waveform"]')).map(el => el.width),
    )
    assert.equal(waveCanvases.length, 5)
    assert.ok(waveCanvases.every(w => w > 30))

    const sfxWaveStats = await getCanvasStats('.tk-track-clip[data-clip-id="pod-sfx-1"] canvas[data-media-role="waveform"]')
    assert.ok(sfxWaveStats && sfxWaveStats.distinctColors >= 2)

    // Drag SFX clip slightly (~14px -> ~350ms, should snap to 500ms multiple!)
    const sfxBox = await page.getBox('.tk-track-clip[data-clip-id="pod-sfx-1"]')
    await page.drag({ x: sfxBox.cx, y: sfxBox.cy }, { x: sfxBox.cx + 16, y: sfxBox.cy }, 8)

    const sfxStart = await page.evaluate(() => {
      const d = window.__TIMELINE_DEMO__.getEditor().getDocument()
      return d.tracks.flatMap(t => t.clips).find(c => c.id === 'pod-sfx-1').startMs
    })
    assert.equal(sfxStart % 500, 0, `Expected grid snap to 500ms multiple, got ${sfxStart}ms`)
  })

  it('10. renders multi-camera Mediabunny video filmstrips, handles video-only silent wave, and updates frames on zoom', async () => {
    await switchScenario('video-filmstrip')

    await waitForDecodedCanvas('.tk-track-clip[data-clip-id="aroll-sintel"] canvas[data-media-role="filmstrip"]', 'true')
    await waitForDecodedCanvas('.tk-track-clip[data-clip-id="broll-bug"] canvas[data-media-role="filmstrip"]', 'true')
    await waitForDecodedCanvas('.tk-track-clip[data-clip-id="broll-bug"] canvas[data-media-role="waveform"]', 'silent')

    const beforeStats = await getCanvasStats('.tk-track-clip[data-clip-id="aroll-sintel"] canvas[data-media-role="filmstrip"]')
    assert.ok(beforeStats && beforeStats.distinctColors >= 8)

    await page.click('.tk-zoom-button[data-command="zoom-in"]')
    await page.waitForFunction(
      (prevW) => {
        const el = document.querySelector('.tk-track-clip[data-clip-id="aroll-sintel"] canvas[data-media-role="filmstrip"]')
        return Boolean(el && el.width > prevW && el.dataset.decoded === 'true')
      },
      [beforeStats.width],
      8000,
    )

    const afterStats = await getCanvasStats('.tk-track-clip[data-clip-id="aroll-sintel"] canvas[data-media-role="filmstrip"]')
    assert.ok(afterStats && afterStats.width > beforeStats.width, 'Zooming in should expand filmstrip canvas width')
    assert.ok(afterStats.distinctColors >= 8, 'Zoomed filmstrip should re-decode multi-color frames')
  })

  it('11. inserts external material via dragover and drop into timeline', async () => {
    await switchScenario('full-studio')

    const beforeCount = await page.evaluate(() =>
      window.__TIMELINE_DEMO__.getEditor().getDocument().tracks.reduce((sum, t) => sum + t.clips.length, 0),
    )
    const track0Box = await page.getBox('.tk-track-row[data-track-index="0"]')
    const dropX = track0Box.x + 560 // ~14s (empty area at end of text track)
    const dropY = track0Box.cy

    await page.evaluate((x, y) => {
      const viewport = document.querySelector('.tk-tracks-viewport')
      const dt = new DataTransfer()
      dt.setData('application/x-timeline-kit-material', JSON.stringify({
        type: 'text',
        name: '拖入花字',
        durationMs: 2500,
        resource: '外部拖入花字成功！',
        meta: { preset: 'gradient' },
      }))
      viewport.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }))
      viewport.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }))
    }, dropX, dropY)

    const afterClips = await page.evaluate(() =>
      window.__TIMELINE_DEMO__.getEditor().getDocument().tracks.flatMap(t => t.clips),
    )
    assert.equal(afterClips.length, beforeCount + 1)
    assert.ok(afterClips.some(c => c.resource === '外部拖入花字成功！'))
  })

  it('12. virtualizes 128 clips horizontally and unmounts offscreen slots on scroll', async () => {
    await switchScenario('virtualized-stress')

    const initialInfo = await page.evaluate(() => ({
      totalClips: window.__TIMELINE_DEMO__.getEditor().getDocument().tracks.reduce((s, t) => s + t.clips.length, 0),
      mountedClips: document.querySelectorAll('.tk-track-clip').length,
      hasFirst: Boolean(document.querySelector('.tk-track-clip[data-clip-id="stress-vid-0"]')),
      hasMid: Boolean(document.querySelector('.tk-track-clip[data-clip-id="stress-vid-18"]')),
    }))
    assert.equal(initialInfo.totalClips, 128)
    assert.ok(initialInfo.mountedClips < 50, `Expected virtualized DOM clip count < 50, got ${initialInfo.mountedClips}`)
    assert.equal(initialInfo.hasFirst, true)
    assert.equal(initialInfo.hasMid, false)

    // Scroll far right (~180s = 7200px)
    await page.evaluate(() => {
      const scroller = document.querySelector('.tk-timeline-main-scroller')
      scroller.scrollLeft = 7200
      scroller.dispatchEvent(new Event('scroll'))
    })
    await new Promise(r => setTimeout(r, 40))

    const scrolledInfo = await page.evaluate(() => ({
      mountedClips: document.querySelectorAll('.tk-track-clip').length,
      hasFirst: Boolean(document.querySelector('.tk-track-clip[data-clip-id="stress-vid-0"]')),
      hasMid: Boolean(document.querySelector('.tk-track-clip[data-clip-id="stress-vid-18"]')),
      stats: window.__TIMELINE_DEMO__.getSlotLifecycleStats(),
    }))
    assert.ok(scrolledInfo.mountedClips < 50)
    assert.equal(scrolledInfo.hasFirst, false, 'Offscreen initial clip should unmount from DOM')
    assert.equal(scrolledInfo.hasMid, true, 'Scrolled-into-view clip #18 should mount')
    assert.ok(scrolledInfo.stats.destroys > 0, 'Custom slot destroy() must run when scrolled offscreen')
  })

  it('13. supports headless external history, OTIO roundtrip, and dark/light theme switching', async () => {
    await switchScenario('headless-external-history')

    const toolbarDisplay = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.tk-timeline-toolbar')).display,
    )
    assert.equal(toolbarDisplay, 'none', 'Headless scenario should hide built-in toolbar')

    // Select hl-v1, seek to 2s (48 frames), trigger host Split button
    await page.click('.tk-track-clip[data-clip-id="hl-v1"]')
    await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().setCurrentFrame(48))
    await page.click('#ext-split')

    let extStats = await page.evaluate(() => window.__TIMELINE_DEMO__.getExternalHistoryStats())
    assert.equal(extStats.past, 1, 'External history should intercept clip:split')

    let videoCount = await page.evaluate(() =>
      window.__TIMELINE_DEMO__.getEditor().getDocument().tracks[0].clips.length,
    )
    assert.equal(videoCount, 3)

    await page.click('#ext-undo')
    videoCount = await page.evaluate(() =>
      window.__TIMELINE_DEMO__.getEditor().getDocument().tracks[0].clips.length,
    )
    assert.equal(videoCount, 2, 'Host external Undo should restore previous document')

    // OTIO Roundtrip
    await switchScenario('otio-roundtrip')
    const otioSummary = await page.evaluate(() => window.__TIMELINE_DEMO__.getOtioSummary())
    assert.equal(otioSummary.schema, 'Timeline.1')
    assert.equal(otioSummary.trackCount, 4)

    // Theme switching updates DOM data-theme AND Canvas ruler palette
    const darkRuler = await getCanvasStats('canvas.tk-ruler-canvas')
    await page.click('#btn-theme') // dark -> light
    const themeAfterClick = await page.evaluate(() =>
      document.querySelector('.tk-timeline-editor').dataset.theme,
    )
    assert.equal(themeAfterClick, 'light')
    const lightRuler = await getCanvasStats('canvas.tk-ruler-canvas')
    assert.notEqual(lightRuler.sampleBg, darkRuler.sampleBg, 'Ruler canvas background must change between dark and light themes')
  })

  it('14. plays real Mediabunny video and audio in real time, advances frames across clip boundary at 2x speed, and toggles cleanly with Space', async () => {
    await switchScenario('full-studio')
    await waitForDecodedCanvas('canvas.tk-preview-canvas', 'true')
    const digest0 = await getCanvasDigest('canvas.tk-preview-canvas')

    await page.click('.tk-preview-play-btn')
    const playingNow = await page.evaluate(() => window.__TIMELINE_DEMO__.getPreviewPlayer().isPlaying())
    assert.equal(playingNow, true)

    await page.waitForFunction(() => {
      const player = window.__TIMELINE_DEMO__.getPreviewPlayer()
      const stats = player.getPlaybackStats()
      return (
        window.__TIMELINE_DEMO__.getEditor().getCurrentFrame() >= 10
        && stats.framesPainted >= 2
        && stats.audioBuffersScheduled >= 1
        && stats.peakAudioLevel > 0.005
      )
    }, [], 6000)

    const midStats = await page.evaluate(() => window.__TIMELINE_DEMO__.getPreviewPlayer().getPlaybackStats())
    assert.ok(midStats.audioBuffersScheduled >= 1, 'Playback should schedule decoded Mediabunny AudioBuffers')
    assert.ok(midStats.peakAudioLevel > 0.005, `Expected live AnalyserNode VU level > 0.005, got ${midStats.peakAudioLevel}`)
    const digest1 = await getCanvasDigest('canvas.tk-preview-canvas')
    assert.notEqual(digest1, digest0, 'Canvas stage pixels must advance during playback')

    // Pause via button and verify playhead freezes
    await page.click('.tk-preview-play-btn')
    const pausedState = await page.evaluate(() => ({
      playing: window.__TIMELINE_DEMO__.getPreviewPlayer().isPlaying(),
      frame: window.__TIMELINE_DEMO__.getEditor().getCurrentFrame(),
    }))
    assert.equal(pausedState.playing, false)
    await new Promise(r => setTimeout(r, 200))
    const afterPauseFrame = await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getCurrentFrame())
    assert.equal(afterPauseFrame, pausedState.frame, 'Frame must stay frozen after pause')

    // Seek near end of vid-opening (frame 102 = 4250ms), switch to 2x speed, and play across clip boundary via Space
    await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().setCurrentFrame(102))
    await page.click('[data-transport="speed"]') // 1x -> 1.5x
    await page.click('[data-transport="speed"]') // 1.5x -> 2x
    const rate = await page.evaluate(() => window.__TIMELINE_DEMO__.getPreviewPlayer().getPlaybackStats().playbackRate)
    assert.equal(rate, 2)

    await page.pressKey('Space')
    const playingViaSpace = await page.evaluate(() => window.__TIMELINE_DEMO__.getPreviewPlayer().isPlaying())
    assert.equal(playingViaSpace, true, 'Space should start playback')

    await page.waitForFunction(
      () => window.__TIMELINE_DEMO__.getPreviewPlayer().getPlaybackStats().activeVideoClipId === 'vid-cyber',
      [],
      4000,
    )

    await page.pressKey('Space')
    const pausedViaSpace = await page.evaluate(() => window.__TIMELINE_DEMO__.getPreviewPlayer().isPlaying())
    assert.equal(pausedViaSpace, false, 'Space should pause playback')
  })

  it('15. composites video, image, and fancy text on stage canvas, reacts live to track visibility toggle, switches aspect ratio, and exports PNG snapshot', async () => {
    await switchScenario('full-studio')
    await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().setCurrentFrame(48))
    await waitForDecodedCanvas('canvas.tk-preview-canvas', 'true')
    await page.waitForSelector('.tk-stage-handle[data-clip-id="img-leopard"]')
    await page.waitForSelector('.tk-stage-handle[data-clip-id="txt-neon-1"]')
    await page.waitForFunction(() => {
      const imgs = Array.from(document.querySelectorAll('.tk-image-clip-thumb'))
      return imgs.length >= 2 && imgs.every(img => img.complete && img.naturalWidth > 0)
    })

    const initialStats = await page.evaluate(() => window.__TIMELINE_DEMO__.getPreviewPlayer().getPlaybackStats())
    assert.equal(initialStats.activeVideoClipId, 'vid-opening')
    assert.equal(initialStats.activeImageClipIds.includes('img-leopard'), true)
    assert.equal(initialStats.activeTextClipIds.includes('txt-neon-1'), true)

    const beforeDigest = await getCanvasDigest('canvas.tk-preview-canvas')

    // Hide main video track (track-index 2) and confirm stage canvas updates while text layer remains
    await page.click('.tk-track-label[data-track-index="2"] .tk-track-toggle[data-track-command="visible"]')
    await page.waitForFunction(
      () => window.__TIMELINE_DEMO__.getPreviewPlayer().getPlaybackStats().activeVideoClipId === null,
      [],
      3000,
    )
    const afterHideDigest = await getCanvasDigest('canvas.tk-preview-canvas')
    assert.notEqual(afterHideDigest, beforeDigest, 'Hiding video track must update composited stage canvas')
    const textHandleExists = await page.evaluate(() => Boolean(document.querySelector('.tk-stage-handle[data-clip-id="txt-neon-1"]')))
    assert.equal(textHandleExists, true)

    // Restore video visibility and switch stage aspect ratio 16:9 -> 9:16 -> 16:9
    await page.click('.tk-track-label[data-track-index="2"] .tk-track-toggle[data-track-command="visible"]')
    await page.click('[data-stage-aspect="9:16"]')
    const portraitDims = await page.evaluate(() => {
      const c = document.querySelector('canvas.tk-preview-canvas')
      return { width: c.width, height: c.height, aspect: c.dataset.aspect }
    })
    assert.deepEqual(portraitDims, { width: 360, height: 640, aspect: '9:16' })

    await page.click('[data-stage-aspect="16:9"]')
    const landscapeDims = await page.evaluate(() => {
      const c = document.querySelector('canvas.tk-preview-canvas')
      return { width: c.width, height: c.height, aspect: c.dataset.aspect }
    })
    assert.deepEqual(landscapeDims, { width: 640, height: 360, aspect: '16:9' })

    // Capture composited PNG snapshot
    await page.click('[data-stage-action="snapshot"]')
    const snapshotUrl = await page.evaluate(() => document.querySelector('.tk-preview-shell')?.dataset.lastSnapshot || '')
    assert.equal(snapshotUrl.startsWith('data:image/png;base64,'), true)
    assert.ok(snapshotUrl.length > 1000, `Expected non-empty PNG snapshot data URL, got length ${snapshotUrl.length}`)
  })

  it('16. supports interactive stage drag synced with timeline selection & undo, quick-add fancy text, and frame-step/reset transport controls', async () => {
    await switchScenario('full-studio')
    await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().setCurrentFrame(48))
    await waitForDecodedCanvas('canvas.tk-preview-canvas', 'true')
    await page.waitForSelector('.tk-stage-handle[data-clip-id="txt-neon-1"]')

    const handleBox = await page.getBox('.tk-stage-handle[data-clip-id="txt-neon-1"]')
    await page.drag(
      { x: handleBox.cx, y: handleBox.cy },
      { x: handleBox.cx - 40, y: handleBox.cy - 45 },
      8,
    )

    const afterStageDrag = await page.evaluate(() => {
      const ed = window.__TIMELINE_DEMO__.getEditor()
      const clip = ed.getDocument().tracks.flatMap(t => t.clips).find(c => c.id === 'txt-neon-1')
      return {
        selected: ed.getState().selection.clipIds,
        stage: clip?.meta?.stage ?? null,
      }
    })
    assert.deepEqual(afterStageDrag.selected, ['txt-neon-1'])
    assert.ok(afterStageDrag.stage && afterStageDrag.stage.x < 0.48 && afterStageDrag.stage.y < 0.78, `Expected persisted stage transform, got ${JSON.stringify(afterStageDrag.stage)}`)

    // Ctrl+Z should undo the stage drag transform
    await page.pressKey('z', MOD_CTRL)
    const afterUndoStage = await page.evaluate(() => {
      const clip = window.__TIMELINE_DEMO__.getEditor().getDocument().tracks.flatMap(t => t.clips).find(c => c.id === 'txt-neon-1')
      return clip?.meta?.stage ?? null
    })
    assert.equal(afterUndoStage, null, 'Ctrl+Z must undo persisted stage transform')

    // Quick-add fancy text via stage toolbar button
    const textCountBefore = await page.evaluate(() =>
      window.__TIMELINE_DEMO__.getEditor().getDocument().tracks.flatMap(t => t.clips).filter(c => c.type === 'text').length,
    )
    await page.click('[data-stage-action="add-text"]')
    const afterAddText = await page.evaluate(() => {
      const ed = window.__TIMELINE_DEMO__.getEditor()
      const texts = ed.getDocument().tracks.flatMap(t => t.clips).filter(c => c.type === 'text')
      const primaryId = ed.getState().selection.clipId
      return {
        count: texts.length,
        primaryId,
        hasStageHandle: Boolean(document.querySelector(`.tk-stage-handle[data-clip-id="${primaryId}"]`)),
      }
    })
    assert.equal(afterAddText.count, textCountBefore + 1)
    assert.equal(afterAddText.hasStageHandle, true, 'Newly added fancy text should render immediately on stage overlay')

    // Transport frame step and reset controls
    await page.click('[data-transport="next-frame"]')
    assert.equal(await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getCurrentFrame()), 49)

    await page.click('[data-transport="prev-frame"]')
    assert.equal(await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getCurrentFrame()), 48)

    await page.click('[data-transport="start"]')
    assert.equal(await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getCurrentFrame()), 0)
  })

  it('17. plays audio-only podcast-audio scenario with live audio visualizer stage, VU meter, and track mute sync', async () => {
    await switchScenario('podcast-audio')

    await page.waitForFunction(() => {
      const waves = Array.from(document.querySelectorAll('canvas[data-media-role="waveform"]'))
      const stage = document.querySelector('canvas.tk-preview-canvas')
      return (
        waves.length === 5
        && waves.every(w => w.dataset.decoder === 'mediabunny' && w.dataset.decoded === 'true')
        && Boolean(stage && stage.dataset.stageMode === 'audio' && stage.dataset.decoded === 'true')
      )
    }, [], 8000)

    const initialStageStats = await getCanvasStats('canvas.tk-preview-canvas')
    assert.ok(initialStageStats && initialStageStats.distinctColors >= 4, `Expected multi-color audio PCM stage, got ${initialStageStats?.distinctColors}`)

    const beforeDigest = await getCanvasDigest('canvas.tk-preview-canvas')
    await page.click('.tk-preview-play-btn')

    await page.waitForFunction(() => {
      const p = window.__TIMELINE_DEMO__.getPreviewPlayer()
      const s = p.getPlaybackStats()
      return (
        window.__TIMELINE_DEMO__.getEditor().getCurrentFrame() >= 8
        && s.stageMode === 'audio'
        && s.audioBuffersScheduled >= 1
        && s.peakAudioLevel > 0.005
      )
    }, [], 6000)

    const duringDigest = await getCanvasDigest('canvas.tk-preview-canvas')
    assert.notEqual(duringDigest, beforeDigest, 'Live audio playback must animate spectrum/oscilloscope stage')

    // Mute track 0 while playing, then pause cleanly
    await page.click('.tk-track-label[data-track-index="0"] .tk-track-toggle[data-track-command="muted"]')
    await page.click('.tk-preview-play-btn')
    const afterPause = await page.evaluate(() => ({
      playing: window.__TIMELINE_DEMO__.getPreviewPlayer().isPlaying(),
      frame: window.__TIMELINE_DEMO__.getEditor().getCurrentFrame(),
      mutedTrack0: window.__TIMELINE_DEMO__.getEditor().getDocument().tracks[0].muted,
    }))
    assert.equal(afterPause.playing, false)
    assert.equal(afterPause.mutedTrack0, true)

    await new Promise(r => setTimeout(r, 150))
    assert.equal(
      await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getCurrentFrame()),
      afterPause.frame,
      'Audio scenario frame must freeze after pause',
    )
  })

  it('18. plays and edits graphics-only fancy-text-graphics scenario on stage canvas while protecting locked tracks', async () => {
    await switchScenario('fancy-text-graphics')
    await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().setCurrentFrame(60))

    await page.waitForFunction(() => {
      const stage = document.querySelector('canvas.tk-preview-canvas')
      const imgs = Array.from(document.querySelectorAll('.tk-image-clip-thumb'))
      return (
        Boolean(stage && stage.dataset.stageMode === 'graphics' && stage.dataset.decoded === 'true')
        && Boolean(document.querySelector('.tk-stage-handle[data-clip-id="gfx-neon"]'))
        && Boolean(document.querySelector('.tk-stage-handle[data-clip-id="gfx-logo-locked"]'))
        && imgs.length >= 1
        && imgs.every(img => img.complete && img.naturalWidth > 0)
      )
    }, [], 6000)

    const stageStats = await page.evaluate(() => window.__TIMELINE_DEMO__.getPreviewPlayer().getPlaybackStats())
    assert.equal(stageStats.activeVideoClipId, null)
    assert.equal(stageStats.stageMode, 'graphics')
    assert.equal(stageStats.activeTextClipIds.includes('gfx-neon'), true)
    assert.equal(stageStats.activeTextClipIds.includes('gfx-variety'), true)
    assert.equal(stageStats.activeImageClipIds.includes('gfx-logo-locked'), true)

    const canvasStats = await getCanvasStats('canvas.tk-preview-canvas')
    assert.ok(canvasStats && canvasStats.distinctColors >= 8, `Expected multi-color graphics stage, got ${canvasStats?.distinctColors}`)

    // Locked track clip handle must be marked locked and refuse stage drag
    const lockedHandle = await page.evaluate(() => {
      const el = document.querySelector('.tk-stage-handle[data-clip-id="gfx-logo-locked"]')
      return el ? { locked: el.classList.contains('is-locked'), dataLocked: el.dataset.locked } : null
    })
    assert.deepEqual(lockedHandle, { locked: true, dataLocked: 'true' })

    const lockedBox = await page.getBox('.tk-stage-handle[data-clip-id="gfx-logo-locked"]')
    await page.drag({ x: lockedBox.cx, y: lockedBox.cy }, { x: lockedBox.cx - 40, y: lockedBox.cy + 30 }, 6)
    const lockedStageAfterDrag = await page.evaluate(() => {
      const clip = window.__TIMELINE_DEMO__.getEditor().getDocument().tracks.flatMap(t => t.clips).find(c => c.id === 'gfx-logo-locked')
      return clip?.meta?.stage ?? null
    })
    assert.equal(lockedStageAfterDrag, null, 'Locked track clip must not be moved on stage canvas')

    // Playback advances frames smoothly across graphics-only timeline and pauses cleanly
    await page.click('.tk-preview-play-btn')
    await page.waitForFunction(
      () => window.__TIMELINE_DEMO__.getEditor().getCurrentFrame() >= 70,
      [],
      4000,
    )
    await page.click('.tk-preview-play-btn')
    const pausedFrame = await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getCurrentFrame())
    await new Promise(r => setTimeout(r, 150))
    assert.equal(
      await page.evaluate(() => window.__TIMELINE_DEMO__.getEditor().getCurrentFrame()),
      pausedFrame,
      'Graphics scenario frame must freeze after pause',
    )
  })
})
