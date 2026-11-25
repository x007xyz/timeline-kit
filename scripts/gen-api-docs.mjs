import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

function loadTypeScript() {
  const req = createRequire(import.meta.url)
  try {
    return req('typescript')
  }
  catch {
    const globalTs = path.resolve(path.dirname(process.execPath), '../lib/node_modules/typescript')
    return req(globalTs)
  }
}

const ts = loadTypeScript()

const API_PAGES = [
  {
    outFile: 'docs/src/content/docs/api/editor.mdx',
    title: 'Editor 控制器与选项',
    description: 'TimelineEditor 主控制器、createTimelineEditor 工厂函数与配置项 API 参考。',
    entries: ['src/editor/index.ts'],
  },
  {
    outFile: 'docs/src/content/docs/api/model-and-otio.mdx',
    title: 'Model 与 OTIO 适配器',
    description: 'TimelineDocument 数据结构、纯编辑操作函数以及双向 OTIO 转换器 API 参考。',
    entries: ['src/model/index.ts', 'src/adapters/otio.ts', 'src/utils/trimOffset.ts'],
  },
  {
    outFile: 'docs/src/content/docs/api/engine-store-plugins.mdx',
    title: 'Engine、Store 与 Plugins',
    description: '时间缩放、布局、虚拟化、吸附、命中测试、Store、CommandBus 与插件接口参考。',
    entries: ['src/engine/index.ts', 'src/store/index.ts', 'src/plugins/index.ts'],
  },
  {
    outFile: 'docs/src/content/docs/api/renderer-and-frameworks.mdx',
    title: 'Renderer 与多框架桥接',
    description: 'DOM+Canvas 混合渲染器、Slot 生命周期、SlotBridge 与 React / Vue 适配层 API 参考。',
    entries: [
      'src/renderer/index.ts',
      'src/frameworks/slotBridge.ts',
      'adapters/react/index.ts',
      'adapters/vue/index.ts',
    ],
  },
]

function loadProgram() {
  const configPath = path.join(rootDir, 'tsconfig.adapters.json')
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
  if (configFile.error) {
    throw new Error(ts.formatDiagnostic(configFile.error, {
      getCanonicalFileName: f => f,
      getCurrentDirectory: () => rootDir,
      getNewLine: () => '\n',
    }))
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, rootDir)
  return ts.createProgram(parsed.fileNames, parsed.options)
}

function escapeTableCell(text) {
  return String(text)
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/`/g, "'")
    .trim()
}

function hasPrivateOrProtectedModifier(node) {
  if (!ts.canHaveModifiers(node)) {
    return false
  }
  const mods = ts.getModifiers(node) ?? []
  return mods.some(m => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword)
}

function getSourceSummary(checker, symbol, decl) {
  const type = checker.getTypeOfSymbolAtLocation(symbol, decl)
  const flags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.WriteArrayAsGenericType

  if (ts.isClassDeclaration(decl)) {
    const className = symbol.getName()
    const lines = [`class ${className} {`]
    for (const member of decl.members) {
      if (hasPrivateOrProtectedModifier(member)) {
        continue
      }
      if (ts.isConstructorDeclaration(member)) {
        const params = member.parameters.map(p => p.getText()).join(', ')
        lines.push(`  constructor(${params});`)
      }
      else if (ts.isMethodDeclaration(member) && member.name) {
        const methodName = member.name.getText()
        const methodSym = checker.getSymbolAtLocation(member.name)
        const methodType = methodSym ? checker.getTypeOfSymbolAtLocation(methodSym, member) : undefined
        const sigs = methodType ? methodType.getCallSignatures() : []
        if (sigs.length > 0) {
          lines.push(`  ${methodName}${checker.signatureToString(sigs[0], member, flags)};`)
        }
        else {
          lines.push(`  ${methodName}(...);`)
        }
      }
      else if (ts.isPropertyDeclaration(member) && member.name) {
        const propName = member.name.getText()
        const propSym = checker.getSymbolAtLocation(member.name)
        const propType = propSym ? checker.typeToString(checker.getTypeOfSymbolAtLocation(propSym, member), member, flags) : 'unknown'
        lines.push(`  ${propName}: ${propType};`)
      }
    }
    lines.push('}')
    return {
      category: 'classes',
      heading: `\`class ${className}\``,
      code: lines.join('\n'),
      propsTable: null,
    }
  }

  if (ts.isInterfaceDeclaration(decl)) {
    const raw = decl.getText().replace(/^export\s+/, '')
    const props = []
    for (const member of decl.members) {
      if (ts.isPropertySignature(member) && member.name) {
        const propName = member.name.getText()
        const optional = member.questionToken ? '?' : ''
        const propType = member.type ? member.type.getText() : 'unknown'
        props.push({ name: `${propName}${optional}`, type: propType })
      }
      else if (ts.isMethodSignature(member) && member.name) {
        const propName = member.name.getText()
        const optional = member.questionToken ? '?' : ''
        const sig = member.getText().replace(new RegExp(`^${propName}\\??`), '').replace(/;$/, '')
        props.push({ name: `${propName}${optional}`, type: sig.trim() || 'Function' })
      }
    }
    return {
      category: 'types',
      heading: `\`interface ${symbol.getName()}\``,
      code: raw,
      propsTable: props.length > 0 ? props : null,
    }
  }

  if (ts.isTypeAliasDeclaration(decl)) {
    const raw = decl.getText().replace(/^export\s+/, '')
    return {
      category: 'types',
      heading: `\`type ${symbol.getName()}\``,
      code: raw,
      propsTable: null,
    }
  }

  const callSigs = type.getCallSignatures()
  if (ts.isFunctionDeclaration(decl) || callSigs.length > 0) {
    const sigStr = callSigs.length > 0
      ? `function ${symbol.getName()}${checker.signatureToString(callSigs[0], decl, flags)}`
      : decl.getText().replace(/^export\s+/, '')
    return {
      category: 'functions',
      heading: `\`${symbol.getName()}()\``,
      code: sigStr,
      propsTable: null,
    }
  }

  const typeStr = checker.typeToString(type, decl, flags)
  return {
    category: 'constants',
    heading: `\`${symbol.getName()}\``,
    code: `const ${symbol.getName()}: ${typeStr}`,
    propsTable: null,
  }
}

function generatePage(program, checker, pageSpec) {
  const seen = new Set()
  const sections = {
    classes: [],
    functions: [],
    types: [],
    constants: [],
  }

  for (const relEntry of pageSpec.entries) {
    const absEntry = path.resolve(rootDir, relEntry)
    const sourceFile = program.getSourceFile(absEntry)
    if (!sourceFile) {
      throw new Error(`Missing source file in TS program: ${relEntry}`)
    }
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
    if (!moduleSymbol) {
      continue
    }

    const exports = checker.getExportsOfModule(moduleSymbol)
    for (const exportedSym of exports) {
      const exportName = exportedSym.getName()
      const isAdapter = relEntry.startsWith('adapters/')
      const dedupeKey = isAdapter ? `${relEntry}:${exportName}` : exportName
      if (exportName === 'default' || seen.has(dedupeKey)) {
        continue
      }
      seen.add(dedupeKey)

      const resolved = (exportedSym.flags & ts.SymbolFlags.Alias) !== 0
        ? checker.getAliasedSymbol(exportedSym)
        : exportedSym
      const decl = resolved.declarations?.[0] ?? exportedSym.declarations?.[0]
      if (!decl) {
        continue
      }

      const summary = getSourceSummary(checker, exportedSym, decl)
      if (isAdapter) {
        const tag = relEntry.includes('react') ? 'React' : 'Vue'
        summary.heading = `${summary.heading} (${tag})`
      }
      sections[summary.category].push(summary)
    }
  }

  const out = [
    '---',
    `title: ${pageSpec.title}`,
    `description: ${pageSpec.description}`,
    '---',
    '',
    'import { Aside } from \'@astrojs/starlight/components\';',
    '',
    '<Aside type="note">',
    `本页由 \`scripts/gen-api-docs.mjs\` 从以下源码入口自动提取生成：${pageSpec.entries.map(e => `\`${e}\``).join('、')}。`,
    '</Aside>',
    '',
  ]

  const groups = [
    ['classes', '类 (Classes)'],
    ['functions', '函数 (Functions)'],
    ['types', '类型与接口 (Types & Interfaces)'],
    ['constants', '常量 (Constants)'],
  ]

  for (const [key, title] of groups) {
    const items = sections[key]
    if (items.length === 0) {
      continue
    }
    out.push(`## ${title}`, '')
    for (const item of items) {
      out.push(`### ${item.heading}`, '')
      out.push('```ts', item.code, '```', '')
      if (item.propsTable) {
        out.push('| 属性 | 类型 |', '| --- | --- |')
        for (const prop of item.propsTable) {
          out.push(`| \`${escapeTableCell(prop.name)}\` | \`${escapeTableCell(prop.type)}\` |`)
        }
        out.push('')
      }
    }
  }

  const outPath = path.resolve(rootDir, pageSpec.outFile)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, out.join('\n'), 'utf8')
  return { outFile: pageSpec.outFile, count: seen.size }
}

const program = loadProgram()
const checker = program.getTypeChecker()
const results = API_PAGES.map(page => generatePage(program, checker, page))
for (const r of results) {
  console.log(`Generated ${r.outFile} (${r.count} exported symbols)`)
}
