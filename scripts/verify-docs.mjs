import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const docsDir = path.join(rootDir, 'docs')
const contentDir = path.join(docsDir, 'src/content/docs')

const ALLOWED_TAGS = new Set([
  'TimelinePlayground',
  'ReactTimelineDemo',
  'VueTimelineDemo',
  'Tabs',
  'TabItem',
  'Card',
  'CardGrid',
  'Aside',
  'div',
  'span',
  'strong',
  'em',
  'code',
  'pre',
  'a',
  'br',
  'hr',
  'p',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'img',
  'template',
])

function collectMdxFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectMdxFiles(full))
    }
    else if (entry.name.endsWith('.mdx') || entry.name.endsWith('.md')) {
      out.push(full)
    }
  }
  return out.sort()
}

function getValidScenarioIds() {
  const src = fs.readFileSync(path.join(rootDir, 'demo/scenarios.ts'), 'utf8')
  const match = src.match(/export type ScenarioId[\s\S]*?(?=\nexport )/)
  if (!match) {
    throw new Error('Could not find ScenarioId union in demo/scenarios.ts')
  }
  const ids = new Set()
  for (const m of match[0].matchAll(/'([a-z0-9-]+)'/g)) {
    ids.add(m[1])
  }
  return ids
}

function getSidebarSlugs() {
  const cfg = fs.readFileSync(path.join(docsDir, 'astro.config.mjs'), 'utf8')
  const slugs = []
  for (const m of cfg.matchAll(/slug:\s*'([^']+)'/g)) {
    slugs.push(m[1])
  }
  return slugs
}

function stripInlineCode(line) {
  return line.replace(/`[^`]*`/g, '')
}

const errors = []
const validScenarios = getValidScenarioIds()
const sidebarSlugs = getSidebarSlugs()

for (const slug of sidebarSlugs) {
  const mdxPath = path.join(contentDir, `${slug}.mdx`)
  const mdPath = path.join(contentDir, `${slug}.md`)
  if (!fs.existsSync(mdxPath) && !fs.existsSync(mdPath)) {
    errors.push(`Sidebar slug "${slug}" missing page at docs/src/content/docs/${slug}.mdx`)
  }
}

const files = collectMdxFiles(contentDir)
let playgroundCount = 0
let internalLinkCount = 0

for (const file of files) {
  const relFile = path.relative(rootDir, file)
  const raw = fs.readFileSync(file, 'utf8')
  const lines = raw.split(/\r?\n/)

  if (!raw.startsWith('---\n')) {
    errors.push(`${relFile}:1 Missing YAML frontmatter opening ---`)
  }
  else {
    const endIdx = lines.indexOf('---', 1)
    if (endIdx === -1) {
      errors.push(`${relFile}:1 Unclosed YAML frontmatter`)
    }
    else {
      const fm = lines.slice(1, endIdx).join('\n')
      if (!/^title:\s*.+/m.test(fm)) {
        errors.push(`${relFile}:1 Frontmatter missing "title"`)
      }
      if (!/^description:\s*.+/m.test(fm)) {
        errors.push(`${relFile}:1 Frontmatter missing "description"`)
      }
    }
  }

  let inFence = false
  let fenceMarker = ''
  let frontmatterEnded = false
  let dashSeen = 0

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1
    const line = lines[i]

    if (!frontmatterEnded) {
      if (line.trim() === '---') {
        dashSeen += 1
        if (dashSeen === 2) {
          frontmatterEnded = true
        }
      }
      continue
    }

    const fenceMatch = line.match(/^\s*(```+|~~~+)/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (!inFence) {
        inFence = true
        fenceMarker = marker
      }
      else if (fenceMarker === marker) {
        inFence = false
        fenceMarker = ''
      }
      continue
    }

    if (inFence) {
      continue
    }

    // Check relative ESM imports
    const importMatch = line.match(/^\s*import\s+[\s\S]*?\bfrom\s+['"](\.[^'"]+)['"]/)
    if (importMatch) {
      const resolvedImport = path.resolve(path.dirname(file), importMatch[1])
      const candidates = [resolvedImport, `${resolvedImport}.tsx`, `${resolvedImport}.ts`, `${resolvedImport}.astro`, `${resolvedImport}.vue`]
      if (!candidates.some(c => fs.existsSync(c))) {
        errors.push(`${relFile}:${lineNo} Broken component import "${importMatch[1]}"`)
      }
      continue
    }

    // Check TimelinePlayground scenario prop
    for (const m of line.matchAll(/<TimelinePlayground\b[^>]*\bscenario=["']([^"']+)["']/g)) {
      playgroundCount += 1
      if (!validScenarios.has(m[1])) {
        errors.push(`${relFile}:${lineNo} Unknown TimelinePlayground scenario "${m[1]}"`)
      }
    }

    // Check internal links like [text](/guide/getting-started/)
    for (const m of line.matchAll(/\[[^\]]+\]\((\/[^)#\s]+)(?:#[^)]*)?\)/g)) {
      internalLinkCount += 1
      const target = m[1].replace(/^\/|\/$/g, '')
      const targetMdx = target ? path.join(contentDir, `${target}.mdx`) : path.join(contentDir, 'index.mdx')
      const targetMd = target ? path.join(contentDir, `${target}.md`) : path.join(contentDir, 'index.md')
      if (!fs.existsSync(targetMdx) && !fs.existsSync(targetMd)) {
        errors.push(`${relFile}:${lineNo} Broken internal doc link "${m[1]}"`)
      }
    }

    // Check for unescaped JSX-like tags or braces outside inline code spans
    const cleaned = stripInlineCode(line)
    for (const m of cleaned.matchAll(/<\/?([A-Za-z][A-Za-z0-9._-]*)\b/g)) {
      const tag = m[1]
      if (!ALLOWED_TAGS.has(tag)) {
        errors.push(`${relFile}:${lineNo} Potential unescaped JSX/generic tag "<${tag}>" in MDX prose`)
      }
    }
  }

  if (inFence) {
    errors.push(`${relFile}:${lines.length} Unclosed fenced code block`)
  }
}

if (errors.length > 0) {
  console.error('Docs verification failed:')
  for (const err of errors) {
    console.error(`  - ${err}`)
  }
  process.exit(1)
}

console.log(
  `Docs verified: ${files.length} pages, ${sidebarSlugs.length} sidebar links, ${playgroundCount} live playgrounds, ${internalLinkCount} internal links, 0 errors.`,
)
