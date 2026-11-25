import fs from 'node:fs'
import http from 'node:http'
import { stripTypeScriptTypes } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.json': 'application/json; charset=utf-8',
}

let cachedMediabunnyBundle = null

function resolveMediabunnyBundle(rootDir) {
  const candidates = [
    path.join(rootDir, 'node_modules/mediabunny/dist/bundles/mediabunny.mjs'),
    path.join(rootDir, 'docs/node_modules/mediabunny/dist/bundles/mediabunny.mjs'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.realpathSync(candidate)
    }
  }
  return null
}

function resolveBrowserTsSpecifier(specifier, filePath, rootDir) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return specifier
  }
  if (path.extname(specifier)) {
    return specifier
  }

  const fileDir = path.dirname(filePath)
  const tsFile = path.resolve(fileDir, `${specifier}.ts`)
  if (fs.existsSync(tsFile)) {
    const rel = path.relative(fileDir, tsFile).split(path.sep).join('/')
    return rel.startsWith('.') ? rel : `./${rel}`
  }

  const indexTsFile = path.resolve(fileDir, specifier, 'index.ts')
  if (fs.existsSync(indexTsFile)) {
    const rel = path.relative(fileDir, indexTsFile).split(path.sep).join('/')
    return rel.startsWith('.') ? rel : `./${rel}`
  }

  const fallback = path.resolve(fileDir, specifier)
  if (fallback.startsWith(rootDir)) {
    return specifier
  }
  return specifier
}

function transformTypeScriptForBrowser(source, filePath, rootDir) {
  const stripped = stripTypeScriptTypes(source, { mode: 'strip' })
  return stripped.replace(
    /(^|\n)([ \t]*(?:import|export)\s+(?:[^;'"`]*?\bfrom\s+)?)(['"])(mediabunny|\.\.?\/[^'"]+)\3/g,
    (full, lineStart, prefix, quote, specifier) => {
      const resolved = specifier === 'mediabunny'
        ? '/__pkg__/mediabunny.mjs'
        : resolveBrowserTsSpecifier(specifier, filePath, rootDir)
      return `${lineStart}${prefix}${quote}${resolved}${quote}`
    },
  )
}

export function resolveLocalAsset(pathname, rootDir, rangeHeader, method = 'GET') {
  const resolvedRoot = path.resolve(rootDir)
  const cleanPath = pathname === '/' ? '/demo/index.html' : pathname
  const isHead = String(method).toUpperCase() === 'HEAD'

  if (cleanPath === '/__pkg__/mediabunny.mjs') {
    if (!cachedMediabunnyBundle) {
      const bundlePath = resolveMediabunnyBundle(resolvedRoot)
      if (bundlePath) {
        cachedMediabunnyBundle = fs.readFileSync(bundlePath)
      }
    }
    if (!cachedMediabunnyBundle) {
      return {
        status: 404,
        contentType: 'text/plain; charset=utf-8',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: isHead ? Buffer.alloc(0) : Buffer.from('mediabunny bundle not found', 'utf8'),
      }
    }
    return {
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      headers: {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Content-Length': String(cachedMediabunnyBundle.length),
        'Cache-Control': 'no-store',
      },
      body: isHead ? Buffer.alloc(0) : cachedMediabunnyBundle,
    }
  }

  let resolvedPath = path.resolve(resolvedRoot, `.${cleanPath}`)

  if (!resolvedPath.startsWith(resolvedRoot)) {
    return {
      status: 403,
      contentType: 'text/plain; charset=utf-8',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: Buffer.from('Forbidden', 'utf8'),
    }
  }

  if (cleanPath.startsWith('/assets/') && (!fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory())) {
    const demoAssetPath = path.resolve(resolvedRoot, 'demo', `.${cleanPath}`)
    if (demoAssetPath.startsWith(resolvedRoot) && fs.existsSync(demoAssetPath) && !fs.statSync(demoAssetPath).isDirectory()) {
      resolvedPath = demoAssetPath
    }
  }

  if (!fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {
    return {
      status: 404,
      contentType: 'text/plain; charset=utf-8',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: Buffer.from(`Not found: ${cleanPath}`, 'utf8'),
    }
  }

  const ext = path.extname(resolvedPath).toLowerCase()
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream'

  if (ext === '.ts') {
    const raw = fs.readFileSync(resolvedPath, 'utf8')
    const transformed = transformTypeScriptForBrowser(raw, resolvedPath, resolvedRoot)
    const body = Buffer.from(transformed, 'utf8')
    return {
      status: 200,
      contentType,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      },
      body,
    }
  }

  const fullBody = fs.readFileSync(resolvedPath)
  const total = fullBody.length

  if (typeof rangeHeader === 'string') {
    const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/)
    if (match) {
      const startStr = match[1]
      const endStr = match[2]
      const start = startStr === ''
        ? Math.max(0, total - Number(endStr || 0))
        : Number(startStr)
      const end = startStr === ''
        ? total - 1
        : endStr === ''
          ? total - 1
          : Math.min(total - 1, Number(endStr))

      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= total) {
        return {
          status: 416,
          contentType: 'text/plain; charset=utf-8',
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Range': `bytes */${total}`,
          },
          body: Buffer.alloc(0),
        }
      }

      const slice = fullBody.subarray(start, end + 1)
      return {
        status: 206,
        contentType,
        headers: {
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Content-Length': String(slice.length),
          'Cache-Control': 'no-store',
        },
        body: isHead ? Buffer.alloc(0) : slice,
      }
    }
  }

  return {
    status: 200,
    contentType,
    headers: {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(total),
      'Cache-Control': 'no-store',
    },
    body: isHead ? Buffer.alloc(0) : fullBody,
  }
}

export async function startDevServer(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
  const requestedPort = options.port ?? 0

  const server = http.createServer((req, res) => {
    const rawUrl = (req.url || '/').split('?')[0]
    const asset = resolveLocalAsset(rawUrl, rootDir, req.headers.range, req.method)
    res.writeHead(asset.status, asset.headers)
    res.end(asset.body)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(requestedPort, '127.0.0.1', resolve)
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : requestedPort
  const url = `http://127.0.0.1:${port}`

  return {
    server,
    port,
    url,
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const port = Number(process.env.PORT ?? 4173)
  const instance = await startDevServer({ port })
  console.log(`timeline-kit demo server running at ${instance.url}/demo/index.html`)
}
