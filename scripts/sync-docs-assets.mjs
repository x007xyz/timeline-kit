// Copies demo/assets/* into docs/public/assets/ so the Astro docs site can serve
// the same media files. Zero dependencies. Files whose size and bytes already
// match are left untouched.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const srcDir = path.join(rootDir, 'demo/assets')
const destDir = path.join(rootDir, 'docs/public/assets')

function isSameContent(src, dest) {
  const srcStat = fs.statSync(src)
  if (!fs.existsSync(dest)) {
    return false
  }
  const destStat = fs.statSync(dest)
  if (srcStat.size !== destStat.size) {
    return false
  }
  return fs.readFileSync(src).equals(fs.readFileSync(dest))
}

fs.mkdirSync(destDir, { recursive: true })

let copied = 0
let skipped = 0

for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
  if (!entry.isFile()) {
    continue
  }
  const src = path.join(srcDir, entry.name)
  const dest = path.join(destDir, entry.name)
  if (isSameContent(src, dest)) {
    skipped += 1
    continue
  }
  fs.copyFileSync(src, dest)
  copied += 1
}

const total = copied + skipped
console.log(
  `Synced docs assets: ${total} files from demo/assets (${copied} copied, ${skipped} unchanged) -> docs/public/assets`,
)
