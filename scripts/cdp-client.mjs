import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveLocalAsset } from './dev-server.mjs'

function findChromeBinary() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN
  }

  for (const playwrightCache of [
    path.join(os.homedir(), 'Library/Caches/ms-playwright'),
    path.join(os.homedir(), '.cache/ms-playwright'),
  ]) {
    if (!fs.existsSync(playwrightCache)) {
      continue
    }
    const dirs = fs.readdirSync(playwrightCache)
      .filter(name => name.startsWith('chromium_headless_shell-'))
      .sort()
      .reverse()
    for (const dir of dirs) {
      for (const arch of ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-linux64', 'chrome-headless-shell-linux']) {
        const bin = path.join(playwrightCache, dir, arch, 'chrome-headless-shell')
        if (fs.existsSync(bin)) {
          return bin
        }
      }
    }
  }

  for (const candidate of [
    '/opt/homebrew/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error('No Chromium / Chrome binary found for E2E tests. Set CHROME_BIN to override.')
}

const KEY_DEFS = {
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Space: { key: ' ', code: 'Space', keyCode: 32 },
  ' ': { key: ' ', code: 'Space', keyCode: 32 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  b: { key: 'b', code: 'KeyB', keyCode: 66 },
  z: { key: 'z', code: 'KeyZ', keyCode: 90 },
  y: { key: 'y', code: 'KeyY', keyCode: 89 },
}

export const MOD_ALT = 1
export const MOD_CTRL = 2
export const MOD_META = 4
export const MOD_SHIFT = 8

export async function launchCdpPage(options = {}) {
  const bin = findChromeBinary()
  const width = options.width ?? 1440
  const height = options.height ?? 900
  const dpr = options.deviceScaleFactor ?? 2
  const localRootDir = options.localRootDir ? path.resolve(options.localRootDir) : null
  const origin = options.origin ?? 'http://localhost'

  const proc = spawn(
    bin,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--remote-debugging-pipe',
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] },
  )

  const writePipe = proc.stdio[3]
  const readPipe = proc.stdio[4]

  let nextId = 0
  let closed = false
  let readBuffer = Buffer.alloc(0)
  const pending = new Map()
  const eventListeners = new Map()

  function rejectAllPending(err) {
    for (const entry of pending.values()) {
      entry.reject(err)
    }
    pending.clear()
  }

  readPipe.on('data', (chunk) => {
    readBuffer = Buffer.concat([readBuffer, chunk])
    let zeroIdx
    while ((zeroIdx = readBuffer.indexOf(0)) !== -1) {
      const raw = readBuffer.subarray(0, zeroIdx).toString('utf8')
      readBuffer = readBuffer.subarray(zeroIdx + 1)
      if (!raw) {
        continue
      }
      const msg = JSON.parse(raw)
      if (msg.id !== undefined) {
        const entry = pending.get(msg.id)
        if (entry) {
          pending.delete(msg.id)
          if (msg.error) {
            entry.reject(new Error(`CDP ${entry.method}: ${msg.error.message}`))
          }
          else {
            entry.resolve(msg.result)
          }
        }
        continue
      }

      const listeners = eventListeners.get(msg.method)
      if (listeners) {
        for (const listener of listeners) {
          listener(msg.params, msg.sessionId)
        }
      }
    }
  })

  proc.once('exit', (code) => {
    if (!closed) {
      rejectAllPending(new Error(`Chromium exited unexpectedly with code ${code}`))
    }
  })

  function send(method, params = {}, sessionId = undefined) {
    if (closed) {
      return Promise.reject(new Error('CDP session already closed'))
    }
    const id = ++nextId
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params }
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, method })
      writePipe.write(`${JSON.stringify(payload)}\0`)
    })
  }

  function onEvent(method, handler) {
    let set = eventListeners.get(method)
    if (!set) {
      set = new Set()
      eventListeners.set(method, set)
    }
    set.add(handler)
    return () => set.delete(handler)
  }

  async function close() {
    if (closed) {
      return
    }
    closed = true
    rejectAllPending(new Error('CDP client closed'))
    try {
      writePipe.destroy()
      readPipe.destroy()
    }
    catch { /* already stopped or closed */ }
    if (!proc.killed) {
      proc.kill('SIGKILL')
      await new Promise((resolve) => {
        proc.once('exit', resolve)
        setTimeout(resolve, 1000)
      })
    }
  }

  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })

    const errors = []
    onEvent('Runtime.exceptionThrown', (params, sid) => {
      if (sid === sessionId) {
        const detail = params.exceptionDetails
        errors.push(detail?.exception?.description || detail?.text || 'Runtime exception')
      }
    })
    onEvent('Runtime.consoleAPICalled', (params, sid) => {
      if (sid === sessionId && params.type === 'error') {
        errors.push(params.args.map(a => a.value ?? a.description ?? '').join(' '))
      }
    })

    await send('Page.enable', {}, sessionId)
    await send('Runtime.enable', {}, sessionId)
    await send('DOM.enable', {}, sessionId)
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: dpr,
      mobile: false,
    }, sessionId)

    if (localRootDir) {
      onEvent('Fetch.requestPaused', async (params, sid) => {
        if (sid !== sessionId) {
          return
        }
        try {
          const url = new URL(params.request.url)
          if (url.origin !== origin) {
            await send('Fetch.continueRequest', { requestId: params.requestId }, sessionId)
            return
          }
          const rangeHeader = params.request.headers?.Range ?? params.request.headers?.range
          const asset = resolveLocalAsset(url.pathname, localRootDir, rangeHeader, params.request.method)
          await send('Fetch.fulfillRequest', {
            requestId: params.requestId,
            responseCode: asset.status,
            responseHeaders: Object.entries(asset.headers).map(([name, value]) => ({ name, value })),
            body: asset.body.toString('base64'),
          }, sessionId)
        }
        catch (err) {
          try {
            await send('Fetch.fulfillRequest', {
              requestId: params.requestId,
              responseCode: 500,
              responseHeaders: [{ name: 'Content-Type', value: 'text/plain; charset=utf-8' }],
              body: Buffer.from(String(err), 'utf8').toString('base64'),
            }, sessionId)
          }
          catch { /* already stopped or closed */ }
        }
      })

      await send('Fetch.enable', {
        patterns: [{ urlPattern: `${origin}/*` }],
      }, sessionId)
    }

    async function evaluate(fnOrExpr, ...args) {
      const expression = typeof fnOrExpr === 'function'
        ? `(${fnOrExpr.toString()})(...${JSON.stringify(args)})`
        : fnOrExpr
      const res = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      }, sessionId)
      if (res.exceptionDetails) {
        throw new Error(`Page eval error: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`)
      }
      return res.result?.value
    }

    async function waitForFunction(fn, args = [], timeoutMs = 6000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const value = await evaluate(fn, ...args)
        if (value) {
          return value
        }
        await new Promise(r => setTimeout(r, 30))
      }
      throw new Error(`Timed out waiting for condition (${timeoutMs}ms)`)
    }

    async function waitForSelector(selector, timeoutMs = 6000) {
      return waitForFunction(sel => Boolean(document.querySelector(sel)), [selector], timeoutMs)
    }

    async function getBox(selector) {
      const box = await evaluate((sel) => {
        const el = document.querySelector(sel)
        if (!el)
          return null
        const r = el.getBoundingClientRect()
        return {
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
          cx: r.left + r.width / 2,
          cy: r.top + r.height / 2,
        }
      }, selector)
      if (!box) {
        throw new Error(`Element not found for getBox: ${selector}`)
      }
      return box
    }

    async function goto(url) {
      await send('Page.navigate', { url }, sessionId)
      await waitForFunction(() => document.readyState === 'complete' && Boolean(window.__TIMELINE_DEMO__?.getEditor?.()), [], 8000)
    }

    async function mouseMove(x, y, buttons = 0, modifiers = 0) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x,
        y,
        buttons,
        modifiers,
      }, sessionId)
    }

    async function mouseDown(x, y, button = 'left', modifiers = 0) {
      await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button,
        buttons: button === 'left' ? 1 : 2,
        clickCount: 1,
        modifiers,
      }, sessionId)
    }

    async function mouseUp(x, y, button = 'left', modifiers = 0) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button,
        buttons: 0,
        clickCount: 1,
        modifiers,
      }, sessionId)
    }

    async function clickPoint(x, y, opts = {}) {
      const modifiers = opts.modifiers ?? 0
      await mouseMove(x, y, 0, modifiers)
      await mouseDown(x, y, 'left', modifiers)
      await mouseUp(x, y, 'left', modifiers)
    }

    async function click(selector, opts = {}) {
      const box = await getBox(selector)
      const x = opts.offsetX !== undefined ? box.x + opts.offsetX : box.cx
      const y = opts.offsetY !== undefined ? box.y + opts.offsetY : box.cy
      await clickPoint(x, y, opts)
    }

    async function drag(from, to, steps = 10, opts = {}) {
      const modifiers = opts.modifiers ?? 0
      const release = opts.release !== false
      await mouseMove(from.x, from.y, 0, modifiers)
      await mouseDown(from.x, from.y, 'left', modifiers)
      for (let step = 1; step <= steps; step += 1) {
        const ratio = step / steps
        const x = from.x + (to.x - from.x) * ratio
        const y = from.y + (to.y - from.y) * ratio
        await mouseMove(x, y, 1, modifiers)
        await new Promise(r => setTimeout(r, 8))
      }
      if (release) {
        await mouseUp(to.x, to.y, 'left', modifiers)
      }
    }

    async function wheel(x, y, deltaX, deltaY, modifiers = 0) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x,
        y,
        deltaX,
        deltaY,
        modifiers,
      }, sessionId)
    }

    async function pressKey(key, modifiers = 0) {
      const def = KEY_DEFS[key] ?? {
        key,
        code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
        keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
      }
      const base = {
        key: def.key,
        code: def.code,
        windowsVirtualKeyCode: def.keyCode,
        nativeVirtualKeyCode: def.keyCode,
        modifiers,
      }
      await send('Input.dispatchKeyEvent', { ...base, type: 'keyDown' }, sessionId)
      await send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' }, sessionId)
    }

    return {
      origin,
      goto,
      evaluate,
      waitForFunction,
      waitForSelector,
      getBox,
      mouseMove,
      mouseDown,
      mouseUp,
      clickPoint,
      click,
      drag,
      wheel,
      pressKey,
      getErrors: () => [...errors],
      clearErrors: () => { errors.length = 0 },
      close,
    }
  }
  catch (err) {
    await close()
    throw err
  }
}
