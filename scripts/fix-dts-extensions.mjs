// Rewrites extensionless relative specifiers in emitted declaration files
// (`from './x'`, `import('./x')`) to explicit `./x.js` / `./x/index.js`, so the
// published types resolve under `moduleResolution: node16 | nodenext` as well
// as `bundler`. Zero dependencies; run after `tsc -p tsconfig.build.json`.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const typesDir = path.join(rootDir, 'dist/types')

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]*)\2/g

function resolveSpecifier(fileDir, spec) {
  if (/\.(js|mjs|cjs|json)$/.test(spec)) {
    return spec
  }
  const target = path.resolve(fileDir, spec)
  if (fs.existsSync(`${target}.d.ts`)) {
    return `${spec}.js`
  }
  if (fs.existsSync(path.join(target, 'index.d.ts'))) {
    return `${spec.replace(/\/$/, '')}/index.js`
  }
  throw new Error(`Cannot resolve declaration import "${spec}" from ${path.relative(rootDir, fileDir)}`)
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : entry.name.endsWith('.d.ts') ? [full] : []
  })
}

let filesChanged = 0
let specifiersChanged = 0
for (const file of walk(typesDir)) {
  const source = fs.readFileSync(file, 'utf8')
  const fileDir = path.dirname(file)
  const next = source.replace(SPECIFIER, (match, lead, quote, spec) => {
    const fixed = resolveSpecifier(fileDir, spec)
    if (fixed === spec) {
      return match
    }
    specifiersChanged += 1
    return `${lead}${quote}${fixed}${quote}`
  })
  if (next !== source) {
    fs.writeFileSync(file, next)
    filesChanged += 1
  }
}

console.log(`fix-dts-extensions: rewrote ${specifiersChanged} specifiers in ${filesChanged} declaration files`)
